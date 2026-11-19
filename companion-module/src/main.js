import { InstanceBase, InstanceStatus } from '@companion-module/base'

const WORKSPACES = [
	{ id: 'show', label: 'Show View' },
	{ id: 'signal', label: 'Signal Explorer' },
	{ id: 'engineering', label: 'Inspect' },
	{ id: 'hyperdecks', label: 'HyperDeck Monitoring' },
]

const ME_CHOICES = [1, 2, 3, 4].map((index) => ({ id: index, label: `M/E ${index}` }))

export default class ShowDeskInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.socket = null
		this.reconnectTimer = null
		this.stopping = false
		this.status = this.emptyStatus()
	}

	emptyStatus() {
		return {
			connection: 'DISCONNECTED', mode: '—', switcher: '—', videoMode: '—',
			workspace: 'show', selectedMe: 1, mixEffects: [], hyperdecks: [],
		}
	}

	async init(config) {
		this.config = config
		this.stopping = false
		this.setupActions()
		this.setupFeedbacks()
		this.setupVariables()
		this.setupPresets()
		this.updateVariables()
		this.connect()
	}

	async destroy() {
		this.stopping = true
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		this.reconnectTimer = null
		if (this.socket) {
			const socket = this.socket
			this.socket = null
			try { socket.close() } catch {}
		}
	}

	getConfigFields() {
		return [
			{
				type: 'dropdown', id: 'channel', label: 'ShowDesk app',
				choices: [
					{ id: 'stable', label: 'ShowDesk (Stable)' },
					{ id: 'beta', label: 'ShowDesk BETA' },
				],
				default: 'beta',
			},
		]
	}

	async configUpdated(config) {
		this.config = config
		this.stopping = false
		this.closeSocket()
		this.connect()
	}

	closeSocket() {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		this.reconnectTimer = null
		if (this.socket) {
			const socket = this.socket
			this.socket = null
			try { socket.close() } catch {}
		}
	}

	connect() {
		if (this.stopping) return
		this.closeSocket()
		const channel = this.config?.channel === 'stable' ? 'stable' : 'beta'
		const port = channel === 'stable' ? 47821 : 47831
		const socket = new WebSocket(`ws://127.0.0.1:${port}/companion`)
		this.socket = socket
		socket.addEventListener('open', () => {
			if (this.socket !== socket) return
			this.updateStatus(InstanceStatus.Ok)
		})
		socket.addEventListener('message', (event) => {
			if (this.socket !== socket) return
			try {
				const message = JSON.parse(String(event.data))
				if (message.type === 'status' && message.data) this.receiveStatus(message.data)
			} catch (error) {
				this.log('warn', `Ignored an unreadable ShowDesk status update: ${error.message}`)
			}
		})
		socket.addEventListener('error', () => {
			if (this.socket === socket) this.updateStatus(InstanceStatus.Disconnected, 'ShowDesk local service unavailable')
		})
		socket.addEventListener('close', () => {
			if (this.socket !== socket) return
			this.socket = null
			this.status.connection = 'DISCONNECTED'
			this.updateVariables()
			this.checkFeedbacks('showdesk_connected', 'workspace_selected', 'me_selected')
			this.updateStatus(InstanceStatus.Disconnected, 'Waiting for ShowDesk local service')
			if (!this.stopping) this.reconnectTimer = setTimeout(() => this.connect(), 2000)
		})
	}

	receiveStatus(data) {
		this.status = {
			...this.emptyStatus(), ...data,
			mixEffects: Array.isArray(data.mixEffects) ? data.mixEffects : [],
			hyperdecks: Array.isArray(data.hyperdecks) ? data.hyperdecks : [],
		}
		this.updateVariables()
		this.checkFeedbacks('showdesk_connected', 'workspace_selected', 'me_selected')
	}

	sendAction(action) {
		if (this.socket?.readyState !== WebSocket.OPEN) {
			this.log('warn', 'ShowDesk is offline; the button action was not sent.')
			return
		}
		this.socket.send(JSON.stringify({ type: 'action', ...action }))
	}

	setupActions() {
		this.setActionDefinitions({
			open_workspace: {
				name: 'Open ShowDesk workspace',
				options: [{
					type: 'dropdown', id: 'workspace', label: 'Workspace',
					choices: WORKSPACES, default: 'show',
				}],
				callback: (event) => this.sendAction({ action: 'workspace', workspace: event.options.workspace }),
			},
			select_me: {
				name: 'Select M/E in Show View',
				options: [{
					type: 'dropdown', id: 'index', label: 'M/E', choices: ME_CHOICES, default: 1,
				}],
				callback: (event) => this.sendAction({ action: 'selectMe', index: Number(event.options.index) }),
			},
		})
	}

	setupVariables() {
		const definitions = {
			connection: { name: 'Connection status' },
			mode: { name: 'ShowDesk mode' },
			switcher: { name: 'Switcher name' },
			video_mode: { name: 'Video format' },
			workspace: { name: 'Current workspace' },
			selected_me: { name: 'Selected M/E' },
		}
		for (let index = 1; index <= 4; index++) {
			definitions[`me_${index}_program`] = { name: `M/E ${index} program source` }
			definitions[`me_${index}_preview`] = { name: `M/E ${index} preview source` }
			definitions[`me_${index}_ftb`] = { name: `M/E ${index} fade to black` }
		}
		for (let index = 1; index <= 8; index++) {
			definitions[`hyperdeck_${index}_name`] = { name: `HyperDeck ${index} name` }
			definitions[`hyperdeck_${index}_status`] = { name: `HyperDeck ${index} transport status` }
			definitions[`hyperdeck_${index}_timecode`] = { name: `HyperDeck ${index} timecode` }
			definitions[`hyperdeck_${index}_recording`] = { name: `HyperDeck ${index} recording` }
		}
		this.setVariableDefinitions(definitions)
	}

	updateVariables() {
		const values = {
			connection: this.status.connection || 'DISCONNECTED',
			mode: this.status.mode || '—',
			switcher: this.status.switcher || '—',
			video_mode: this.status.videoMode || '—',
			workspace: WORKSPACES.find((item) => item.id === this.status.workspace)?.label || 'Show View',
			selected_me: `M/E ${this.status.selectedMe || 1}`,
		}
		for (let index = 1; index <= 4; index++) {
			const me = this.status.mixEffects.find((item) => Number(item.index) === index)
			values[`me_${index}_program`] = me?.program || '—'
			values[`me_${index}_preview`] = me?.preview || '—'
			values[`me_${index}_ftb`] = me?.ftb || '—'
		}
		for (let index = 1; index <= 8; index++) {
			const deck = this.status.hyperdecks[index - 1]
			values[`hyperdeck_${index}_name`] = deck?.name || '—'
			values[`hyperdeck_${index}_status`] = deck?.status || '—'
			values[`hyperdeck_${index}_timecode`] = deck?.timecode || '—'
			values[`hyperdeck_${index}_recording`] = deck?.recording ? 'YES' : 'NO'
		}
		this.setVariableValues(values)
	}

	setupFeedbacks() {
		this.setFeedbackDefinitions({
			showdesk_connected: {
				type: 'boolean', name: 'ShowDesk service connected', options: [],
				defaultStyle: { bgcolor: 0x245c38, color: 0xffffff },
				callback: () => this.socket?.readyState === WebSocket.OPEN,
			},
			workspace_selected: {
				type: 'boolean', name: 'Workspace is active',
				options: [{ type: 'dropdown', id: 'workspace', label: 'Workspace', choices: WORKSPACES, default: 'show' }],
				defaultStyle: { bgcolor: 0x8d292b, color: 0xffffff },
				callback: (feedback) => this.status.workspace === feedback.options.workspace,
			},
			me_selected: {
				type: 'boolean', name: 'M/E is selected',
				options: [{ type: 'dropdown', id: 'index', label: 'M/E', choices: ME_CHOICES, default: 1 }],
				defaultStyle: { bgcolor: 0x8d292b, color: 0xffffff },
				callback: (feedback) => Number(this.status.selectedMe) === Number(feedback.options.index),
			},
		})
	}

	setupPresets() {
		const presets = {}
		const navigationIds = []
		for (const workspace of WORKSPACES) {
			const id = `workspace_${workspace.id}`
			navigationIds.push(id)
			presets[id] = {
				type: 'simple', name: workspace.label,
				style: { text: workspace.label.toUpperCase(), size: '14', color: 0xffffff, bgcolor: 0x292827 },
				steps: [{ down: [{ actionId: 'open_workspace', options: { workspace: workspace.id } }], up: [] }],
				feedbacks: [{ feedbackId: 'workspace_selected', options: { workspace: workspace.id }, style: { bgcolor: 0x8d292b } }],
			}
		}
		const meIds = []
		for (const me of ME_CHOICES) {
			const id = `me_${me.id}`
			meIds.push(id)
			presets[id] = {
				type: 'simple', name: me.label,
				style: { text: me.label.toUpperCase(), size: '16', color: 0xffffff, bgcolor: 0x292827 },
				steps: [{ down: [{ actionId: 'select_me', options: { index: me.id } }], up: [] }],
				feedbacks: [{ feedbackId: 'me_selected', options: { index: me.id }, style: { bgcolor: 0x8d292b } }],
			}
		}
		presets.showdesk_status = {
			type: 'simple', name: 'ShowDesk Connection Status',
			style: { text: 'SHOWDESK\nOFFLINE', size: '14', color: 0xffffff, bgcolor: 0x292827 },
			steps: [{ down: [], up: [] }],
			feedbacks: [{ feedbackId: 'showdesk_connected', options: {}, style: { text: 'SHOWDESK\nONLINE', bgcolor: 0x245c38 } }],
		}
		this.setPresetDefinitions([
			{ id: 'navigation', name: 'ShowDesk Workspaces', definitions: [{ id: 'buttons', type: 'simple', name: 'Workspaces', presets: navigationIds }] },
			{ id: 'mix-effects', name: 'M/E Selection', definitions: [{ id: 'buttons', type: 'simple', name: 'M/Es', presets: meIds }] },
			{ id: 'status', name: 'Status', definitions: [{ id: 'buttons', type: 'simple', name: 'Connection', presets: ['showdesk_status'] }] },
		], presets)
	}
}
