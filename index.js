(function (plugin, metro, patcher, common, components, storageApi, logger) {
    "use strict";

    var storage = plugin.storage;
    var bunny = window.bunny;
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

    if (typeof storage.soundpack !== "string" || storage.soundpack.length === 0) {
        storage.soundpack = "classic";
    }

    function currentPack() {
        return typeof storage.soundpack === "string" && storage.soundpack.length > 0
            ? storage.soundpack
            : "classic";
    }

    function getMetro() {
        return (bunny && bunny.metro) || metro;
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

    function readDiscordPacks() {
        var mod = findExports(function (exported) {
            if (!exported || typeof exported !== "object") return false;
            return Object.values(exported).some(function (value) {
                return typeof value === "string" && value.indexOf("custom_notification_sounds_") !== -1;
            });
        }, "SoundpackControl.packs");

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
        try {
            var api = getMetro();
            var findStore = api.findByStoreNameLazy || api.findByStoreName;
            if (typeof findStore !== "function") {
                logger.error("Metro store lookup is missing");
                return;
            }

            var SoundpackStore = findStore("SoundpackStore");
            if (!SoundpackStore) {
                logger.error("SoundpackStore was not found");
                return;
            }

            unpatches.push(patcher.instead("getSoundpack", SoundpackStore, function () {
                return currentPack();
            }));
            unpatches.push(patcher.instead("getState", SoundpackStore, function (args, orig) {
                var state = orig.apply(this, args);
                if (!state || typeof state !== "object") return state;
                return Object.assign({}, state, { soundpack: currentPack() });
            }));
        } catch (error) {
            logger.error("Failed to patch SoundpackStore", error);
        }
    }

    function Settings() {
        var React = common.React;
        var ReactNative = common.ReactNative;
        storageApi.useProxy(storage);

        var discordPacks = readDiscordPacks();
        var options = mergePacks(discordPacks);
        var selected = currentPack();
        var Forms = components.Forms;
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
                        storage.soundpack = option.value;
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
            patchStore();
            logger.info("Using soundpack " + currentPack());
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
