/**
 * @name SoundpackControl
 * @author Emily the Flareon
 * @description Enables total override of the soundpack even without Nitro
 * @version 0.0.1
 * @authorId 323980738175434752
 * @authorLink https://twitter.com/EmilyTheFlareon
 */

const { Data, React, Webpack, Patcher } = BdApi
const { Filters } = Webpack

const storeFilter = Filters.byStoreName('SoundpackStore')
const packsFilter = (m) => (m && typeof m === 'object') && Object.values(m).some((v) => typeof v === 'string' && v.includes('custom_notification_sounds_'))

/**
 * @template T
 * @param {Promise<T>} promise
 * @returns {?T | undefined}
 */
const usePromise = (promise) => {
	const ref = React.useMemo(() => ({ current: undefined }), [promise])

	/** @type {(listener: () => void) => () => void} */
	const subscribe = React.useCallback((listener) => {
		if (!promise) return () => {}

		let active = true

		promise.then(
			(value) => {
				if (active) {
					ref.current = value ?? null
					listener()
				}
			},
			() => {
				if (active) {
					ref.current = null
					listener()
				}
			}
		)

		return () => { active = false }
	}, [promise, ref])

	/** @type {() => ?T} */
	const getSnapshot = React.useCallback(() => ref.current, [])

	return React.useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * @typedef SoundpackStore
 * @prop {(this: SoundpackStore) => SoundpackStore.State} getState
 * @prop {(this: SoundpackStore) => string} getSoundpack
 * @prop {(this: SoundpackStore) => string} getLastSoundpackExperimentId
 */

/**
 * @typedef SoundpackStore.State
 * @prop {string} soundpack
 * @prop {string} lastSoundpackExperimentId
 */

module.exports = class SoundpackControl {
	soundpack = Data.load('SoundpackControl', 'soundpack') ?? 'classic'

	/** @type {?AbortController} */
	abort = null

	/** @type {?Promise<SoundpackStore>} */
	storePromise = null

	/** @type {?SoundpackStore} */
	store = null

	/** @type {?Promise<unknown>} */
	packsPromise = null

	/** @type {?unknown} */
	packs = null

	/** @type {?() => void} */
	revert = null

	start() {
		this.abort = new AbortController()
		this.store = null
		this.packs = null
		this.revert = null

		this.storePromise = Webpack.waitForModule(storeFilter, { signal: this.abort.signal }).then((SoundpackStore) => {
			this.store = SoundpackStore
			this.revert = Patcher.instead('SoundpackControl', SoundpackStore, 'getSoundpack', this.getSoundpack.bind(this))
		})

		this.packsPromise = Webpack.waitForModule(packsFilter, { signal: this.abort.signal }).then((packs) => {
			this.packs = Object.values(packs).find((v) => typeof v === 'function')()
		})
	}

	getSettingsPanel() {
		const { FocusRingScope, FormSection, FormTitle, RadioGroup, Button, ButtonSizes } = Webpack.getModule(Filters.byKeys('FocusRingScope', 'FormTitle', 'RadioGroup', 'FormSection', 'Button', 'ButtonSizes'))
		const SoundUtils = Webpack.getModule((m) => Object.values(m).some((v) => typeof v === 'function' && String(v).includes('sound for pack name')))
		const playSound = Object.values(SoundUtils).find((v) => typeof v === 'function' && String(v).includes('sound for pack name'))

		const sounds = [
			'discodo',
			'message1',
			'message2',
			'message3',
			'call_calling',
			'call_ringing'
		]

		return () => {
			const SoundpackStore = usePromise(this.storePromise) || this.store
			const soundpacks = usePromise(this.packsPromise) || this.packs

			const options = React.useMemo(() => {
				const map = new Map(soundpacks.map((option) => [option.value, { value: option.value, name: option.label, desc: option.description }]))
				map.set('discodo', { value: 'discodo', name: 'DISCODO', desc: '๑(◕‿◕)๑' })
				map.set('asmr', { value: 'asmr', name: 'ASMR', desc: '*hey there*' })
				map.set('halloween', { value: 'halloween', name: 'Halloween', desc: 'Seasonal event' })
				return [...map.values()]
			}, [soundpacks])

			const [container, setContainer] = React.useState(null)
			const [soundpack, setSoundpack] = React.useState(this.soundpack)
			React.useEffect(() => {
				this.soundpack = soundpack
				Data.save('SoundpackControl', 'soundpack', soundpack)
			}, [soundpack])

			const onChange = React.useCallback(({ value }) => {
				setSoundpack(value)
			}, [setSoundpack])

			return React.createElement('div', { ref: setContainer, style: { display: 'grid', grid: '100% / 50% 50%', gap: 8 } },
				container && React.createElement(FocusRingScope, { containerRef: container.parentNode },
					React.createElement(FormSection, {},
						React.createElement(FormTitle, {}, 'Soundpack'),
						React.createElement(RadioGroup, { options, value: soundpack, onChange })
					),
					React.createElement(FormSection, {},
						React.createElement(FormTitle, {}, 'Sounds'),
						React.createElement('div', { style: { display: 'grid', grid: 'auto-flow min-content / 100%', gap: 8 } },
							sounds.map((sound) =>
								React.createElement(Button, { key: sound, onClick: () => playSound(sound), size: ButtonSizes.SMALL }, sound)
							)
						)
					)
				)
			)
		}
	}

	stop() {
		this.abort?.abort()
		this.revert?.()

		this.abort = null
		this.revert = null
		this.storePromise = null
		this.store = null
		this.packsPromise = null
		this.packs = null
	}

	getSoundpack() {
		return this.soundpack
	}
}
