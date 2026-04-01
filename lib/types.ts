export interface SerialPortOptions {
  path: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'odd' | 'even' | 'mark' | 'space'
  rtscts?: boolean
  xon?: boolean
  xoff?: boolean
  autoOpen?: boolean
}

export interface PortInfo {
  path: string
  portType: string
}

export type PinName = 'CTS' | 'DTR' | 'RTS' | 'DCD' | 'DSR'
