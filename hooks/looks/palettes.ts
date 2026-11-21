// The three looks' colors, as makeColors takes them. Pure data.

export const PAPER = {
  label: 'Paper',
  id: 'cc-cyberpunk-paper',
  roles: { accent: '#2f5d8c', danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#6d4f94' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#efe6d3',
        'surface-1': '#f4ecdc',
        'surface-2': '#faf5e9',
        'text-primary': '#2a241d',
        'text-secondary': '#544a3d',
        'text-muted': '#6a5f50',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#1f1a15',
        'surface-1': '#28221b',
        'surface-2': '#312a22',
        'surface-3': '#3a3229',
        'text-primary': '#f0e7d7',
        'text-secondary': '#cfc4b2',
        'text-muted': '#aca08d',
      },
    },
  },
}

export const MIDNIGHT = {
  label: 'Midnight',
  id: 'cc-cyberpunk-midnight',
  only: 'dark' as const,
  roles: { accent: '#8b7cf6', danger: '#f0717a', success: '#5fd3a0', warning: '#f2b85b', pro: '#d08cf0' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0e0c1f',
        'surface-1': '#151229',
        'surface-2': '#1b1834',
        'surface-3': '#221e3f',
        'text-primary': '#ece9ff',
        'text-secondary': '#c3bde6',
        'text-muted': '#9d96c6',
      },
    },
  },
}

export const CYBERPUNK = {
  label: 'Cyberpunk',
  id: 'cc-cyberpunk-cyberpunk',
  only: 'dark' as const,
  roles: { accent: '#00f0ff', danger: '#ff2a6d', success: '#05ffa1', warning: '#f3e600', pro: '#c77dff' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0b0a14',
        'surface-1': '#120f1f',
        'surface-2': '#181428',
        'surface-3': '#1e1932',
        'text-primary': '#f2f0ff',
        'text-secondary': '#c8c2e8',
        'text-muted': '#9c95c4',
      },
    },
  },
}

export const NORD = {
  label: 'Nord',
  id: 'cc-cyberpunk-nord',
  roles: { accent: '#5e81ac', danger: '#bf616a', success: '#7fa36a', warning: '#d08770', pro: '#b48ead' },
  codeTheme: { dark: 'nord' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#e5e9f0',
        'surface-1': '#eceff4',
        'surface-2': '#f4f6f9',
        'text-primary': '#242933',
        'text-secondary': '#3b4252',
        'text-muted': '#4f586b',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#22262f',
        'surface-1': '#2a2f3a',
        'surface-2': '#303643',
        'surface-3': '#363c4a',
        'text-primary': '#eceff4',
        'text-secondary': '#d0d6e1',
        'text-muted': '#a9b2c3',
      },
    },
  },
}
