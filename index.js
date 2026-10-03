(function (plugin, metro, patcher, common, components, storageApi, logger) {
    "use strict";

    var storage = plugin.storage;
    var bunny = typeof window !== "undefined" ? window.bunny : undefined;
    var unpatches = [];

    var EXTRA_PACKS = [
        { value: "discodo", label: "DISCODO", description: "๑(◕‿◕)๑" },
        { value: "asmr", label: "ASMR", description: "*hey there*" },
        { value: "halloween", label: "Halloween", description: "Seasonal event" },
        { value: "winter_holiday", label: "Winter Holiday", description: "Seasonal event" }
    ];

    var FALLBACK_PACKS = [
        { value: "classic", label: "Classic", description: "The original Discord sounds" },
        { value: "retro", label: "Retro", description: "8-bit sounds" },
        { value: "lofi", label: "Lofi", description: "Chill notification sounds" },
        { value: "ducky", label: "Ducky", description: "Rubber duck sounds" },
        { value: "bop", label: "Bop", description: "Bubble sounds" }
    ].concat(EXTRA_PACKS);

    var PREVIEW_SOUNDS = [
        "discodo",
        "message1",
        "message2",
        "message3",
        "call_calling",
        "call_ringing"
    ];

    function rememberPack() {
        try {
            if (typeof storage.soundpack !== "string" || storage.soundpack.length === 0) {
                storage.soundpack = "classic";
            }
        } catch (error) {}
    }

    function currentPack() {
        return typeof storage.soundpack === "string" && storage.soundpack.length > 0
            ? storage.soundpack
            : "classic";
    }

    function getMetro() {
        return (bunny && bunny.metro) || metro;
    }

    function findStore(name) {
        var api = getMetro();
        var find = api.findByStoreNameLazy || api.findByStoreName;
        if (typeof find !== "function") return null;
        try {
            return find(name);
        } catch (error) {
            return null;
        }
    }

    function tryInstead(parent, name, callback) {
        if (!parent || !name || !patcher || typeof patcher.instead !== "function") return;
        try {
            unpatches.push(patcher.instead(name, parent, callback));
        } catch (error) {
            try { logger.warn("Could not patch " + name, error); } catch (ignored) {}
        }
    }

    function findExports(predicate, id) {
        var api = getMetro();
        if (api.factories && api.factories.createSimpleFilter && api.findExports) {
            return api.findExports(api.factories.createSimpleFilter(predicate, id));
        }
        if (typeof api.find === "function") return api.find(predicate);
        return undefined;
    }

    function isPackOption(value) {
        return !!value
            && typeof value === "object"
            && typeof value.value === "string"
            && (typeof value.label === "string" || typeof value.name === "string");
    }

    function unlockSound(sound) {
        if (!sound || typeof sound !== "object" || !("available" in sound)) return sound;
        if (sound.available) return sound;
        try {
            sound.available = true;
            return sound;
        } catch (error) {
            return Object.assign({}, sound, { available: true });
        }
    }

    function unlockSounds(value) {
        if (!value) return value;
        if (Array.isArray(value)) {
            return value.map(unlockSound);
        }
        if (typeof value.get === "function" && typeof value.set === "function" && typeof value.forEach === "function") {
            value.forEach(function (sounds, guildId) {
                value.set(guildId, unlockSounds(sounds));
            });
            return value;
        }
        return unlockSound(value);
    }

    function unlockTree(node, depth) {
        if (!node || typeof node !== "object" || depth > 6) return;
        if (Array.isArray(node)) {
            for (var i = 0; i < node.length; i++) unlockTree(node[i], depth + 1);
            return;
        }
        if (node.soundId && "available" in node) {
            try { node.available = true; } catch (error) {}
        }
        if ("requirePremium" in node) {
            try { node.requirePremium = false; } catch (error) {}
        }
        var keys = Object.keys(node);
        for (var j = 0; j < keys.length; j++) {
            var child = node[keys[j]];
            if (child && typeof child === "object") unlockTree(child, depth + 1);
        }
    }

    function readDiscordPacks() {
        var mod;
        try {
            mod = findExports(function (exported) {
            try {
                if (!exported || typeof exported !== "object") return false;
                return Object.values(exported).some(function (value) {
                    return typeof value === "string" && value.indexOf("custom_notification_sounds_") !== -1;
                });
            } catch (error) {
                return false;
            }
        }, "SoundpackControl.packs");
        } catch (error) {
            return null;
        }

        if (!mod) return null;

        var reader = Object.values(mod).find(function (value) {
            return typeof value === "function";
        });
        if (typeof reader !== "function") return null;

        try {
            var list = reader();
            return Array.isArray(list) ? list.filter(isPackOption) : null;
        } catch (error) {
            logger.warn("Failed to read Discord's soundpack list", error);
            return null;
        }
    }

    function mergePacks(discordPacks) {
        var map = new Map();
        var source = discordPacks && discordPacks.length > 0 ? discordPacks : FALLBACK_PACKS;
        var i;

        for (i = 0; i < source.length; i++) {
            var pack = source[i];
            map.set(pack.value, {
                value: pack.value,
                label: pack.label || pack.name,
                description: pack.description || pack.desc || ""
            });
        }

        for (i = 0; i < EXTRA_PACKS.length; i++) {
            if (!map.has(EXTRA_PACKS[i].value)) map.set(EXTRA_PACKS[i].value, EXTRA_PACKS[i]);
        }

        if (!map.has(currentPack())) {
            map.set(currentPack(), {
                value: currentPack(),
                label: currentPack(),
                description: "Saved soundpack"
            });
        }

        return Array.from(map.values());
    }

    function isSoundMap(value) {
        return !!value
            && typeof value === "object"
            && value.classic
            && value.classic.message1 === "message1"
            && value.bop
            && typeof value.bop.message1 === "string";
    }

    function findSoundMap() {
        var found = findExports(function (exported) {
            if (!exported || typeof exported !== "object") return false;
            if (isSoundMap(exported)) return true;
            return Object.values(exported).some(isSoundMap);
        }, "SoundpackControl.soundMap");

        if (!found) return null;
        if (isSoundMap(found)) return found;
        return Object.values(found).find(isSoundMap) || null;
    }

    function sourceHas(fn, text) {
        try {
            return typeof fn === "function" && Function.prototype.toString.call(fn).indexOf(text) !== -1;
        } catch (error) {
            return false;
        }
    }

    function findPlaySound() {
        var api = getMetro();
        var bySource = findExports(function (exported) {
            if (!exported || (typeof exported !== "object" && typeof exported !== "function")) return false;
            var values = typeof exported === "function" ? [exported] : Object.values(exported);
            return values.some(function (value) {
                return sourceHas(value, "sound for pack name");
            });
        }, "SoundpackControl.playSound");

        if (typeof bySource === "function" && sourceHas(bySource, "sound for pack name")) return bySource;
        if (bySource && typeof bySource === "object") {
            var match = Object.values(bySource).find(function (value) {
                return sourceHas(value, "sound for pack name");
            });
            if (typeof match === "function") return match;
        }

        var byName = api.findByProps && api.findByProps("playSound");
        if (byName && typeof byName.playSound === "function") return byName.playSound.bind(byName);
        return null;
    }

    function nativePlayers() {
        var proxy = window.nativeModuleProxy;
        if (!proxy) return [];

        var players = [];
        var keys = Object.keys(proxy);
        for (var i = 0; i < keys.length; i++) {
            if (!/sound|audio/i.test(keys[i])) continue;
            var nativeModule = proxy[keys[i]];
            if (!nativeModule) continue;
            if (typeof nativeModule.playSound === "function") players.push(nativeModule.playSound.bind(nativeModule));
            else if (typeof nativeModule.play === "function") players.push(nativeModule.play.bind(nativeModule));
        }
        return players;
    }

    function playPreview(sound) {
        var play = findPlaySound();
        if (play) {
            play(sound);
            return;
        }

        var soundMap = findSoundMap();
        var packSounds = soundMap && soundMap[currentPack()];
        var resolved = (packSounds && packSounds[sound]) || sound;
        var players = nativePlayers();
        if (players.length === 0) {
            vendetta.ui.toasts.showToast("Preview isn't available in this Discord build");
            return;
        }

        for (var i = 0; i < players.length; i++) {
            try {
                players[i](resolved);
                return;
            } catch (error) {
                logger.warn("Native sound preview failed", error);
            }
        }

        vendetta.ui.toasts.showToast("Couldn't play " + sound);
    }

    function patchStore() {
        var SoundpackStore = findStore("SoundpackStore");
        tryInstead(SoundpackStore, "getSoundpack", function () {
            return currentPack();
        });
        tryInstead(SoundpackStore, "getState", function (args, orig) {
            var state = orig.apply(this, args);
            if (!state || typeof state !== "object") return state;
            return Object.assign({}, state, { soundpack: currentPack() });
        });
    }

    function patchPremium() {
        var overrideStore = findStore("OverridePremiumTypeStore");
        tryInstead(overrideStore, "getState", function (args, orig) {
            var state = orig.apply(this, args) || {};
            return Object.assign({}, state, { premiumTypeOverride: 2 });
        });
        tryInstead(overrideStore, "getPremiumTypeOverride", function () {
            return 2;
        });
    }

    function patchSoundboard() {
        var store = findStore("SoundboardStore");
        ["getSound", "getSoundById", "getSounds", "getSoundsForGuild"].forEach(function (name) {
            tryInstead(store, name, function (args, orig) {
                return unlockSounds(orig.apply(this, args));
            });
        });

        var packsMod = null;
        try {
            packsMod = findExports(function (exported) {
                try {
                    if (!exported || typeof exported !== "object") return false;
                    return Object.values(exported).some(function (value) {
                        return typeof value === "string" && value.indexOf("custom_notification_sounds_") !== -1;
                    });
                } catch (error) {
                    return false;
                }
            }, "SoundpackControl.packList");
        } catch (error) {
            packsMod = null;
        }

        if (packsMod) {
            var readerName = Object.keys(packsMod).find(function (key) {
                return typeof packsMod[key] === "function";
            });
            tryInstead(packsMod, readerName, function (args, orig) {
                var list = orig.apply(this, args);
                if (!Array.isArray(list)) return list;
                return list.map(function (option) {
                    if (!option || typeof option !== "object") return option;
                    return Object.assign({}, option, { requirePremium: false });
                });
            });
        }

        if (bunny && bunny.api && bunny.api.flux && bunny.api.flux.intercept) {
            unpatches.push(bunny.api.flux.intercept(function (payload) {
                if (!payload || typeof payload.type !== "string" || payload.type.indexOf("SOUNDBOARD") === -1) return;
                unlockTree(payload, 0);
            }));
        }
    }

    function applyPack(value) {
        storage.soundpack = value;
        try {
            if (common.FluxDispatcher && typeof common.FluxDispatcher.dispatch === "function") {
                common.FluxDispatcher.dispatch({
                    type: "SET_SOUNDPACK",
                    soundpack: value
                });
            }
        } catch (error) {
            logger.warn("Could not save the soundpack into Discord", error);
        }
    }

    function Settings() {
        var React = common.React;
        var ReactNative = common.ReactNative;
        storageApi.useProxy(storage);

        var discordPacks = readDiscordPacks();
        var options = mergePacks(discordPacks);
        var selected = currentPack();
        var Forms = components && components.Forms;
        if (!Forms || !Forms.FormRadioRow || !Forms.FormRow || !Forms.FormSection || !React || !ReactNative) {
            return React && ReactNative
                ? React.createElement(ReactNative.Text, null, "Soundpack settings are not available in this Discord build.")
                : null;
        }
        var rows = [];
        var previews = [];
        var i;

        for (i = 0; i < options.length; i++) {
            (function (option) {
                rows.push(React.createElement(Forms.FormRadioRow, {
                    key: option.value,
                    label: option.label,
                    subLabel: option.description,
                    selected: selected === option.value,
                    onPress: function () {
                        applyPack(option.value);
                    }
                }));
            })(options[i]);
        }

        for (i = 0; i < PREVIEW_SOUNDS.length; i++) {
            (function (sound) {
                previews.push(React.createElement(Forms.FormRow, {
                    key: sound,
                    label: sound,
                    onPress: function () {
                        playPreview(sound);
                    }
                }));
            })(PREVIEW_SOUNDS[i]);
        }

        return React.createElement(ReactNative.ScrollView, {
            style: { flex: 1 },
            contentContainerStyle: { paddingBottom: 38 }
        },
            React.createElement(Forms.FormSection, {
                title: "Soundpack",
                titleStyleType: "no_border"
            }, rows),
            React.createElement(Forms.FormSection, {
                title: "Sounds",
                titleStyleType: "no_border"
            }, previews)
        );
    }

    return {
        onLoad: function () {
            rememberPack();
            try {
                patchStore();
                patchPremium();
                patchSoundboard();
                logger.info("Using soundpack " + currentPack());
            } catch (error) {
                try { logger.error("SoundpackControl failed to start", error); } catch (ignored) {}
            }
        },
        onUnload: function () {
            var pending = unpatches.splice(0);
            for (var i = 0; i < pending.length; i++) {
                try {
                    pending[i]();
                } catch (error) {
                    logger.error("Failed to remove a patch", error);
                }
            }
        },
        settings: Settings
    };
})(vendetta.plugin, vendetta.metro, vendetta.patcher, vendetta.metro.common, vendetta.ui.components, vendetta.storage, vendetta.logger);
