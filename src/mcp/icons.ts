/**
 * The server's icon for MCP clients (`serverInfo.icons`): brand/web/favicon.svg and the 48 px
 * PNG rendered from it. Inlined as data URIs, so the stdio server needs no network and clients
 * fetch nothing. PNG is the format every client must support; SVG is optional.
 */
import type { Icon } from '@modelcontextprotocol/server';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="t"><title id="t">Portal 2</title><rect width="256" height="256" rx="64" fill="#07080C"/><g transform="translate(28.16 28.16) scale(0.78)"><path id="p" fill="#F2EEE3" d="M48 32H160A48 48 0 0 1 208 80V104A48 48 0 0 1 160 152H88V176H48V112H160A8 8 0 0 0 168 104V80A8 8 0 0 0 160 72H48Z"/><path id="bar" fill="#FDC500" d="M48 192H208V224H48Z"/></g></svg>';

const PNG_48 =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAADrUlEQVR4nOyaZ2gUQRTH/zPbLt7ZUYkNNZYIooKoICIqNgwYCX6w4FcRNAh+ERVBERXBgoqIKNYYFMQSFAuiQQULCoolRs4YSyR+MlGT3N7d7vj2JCEkl5jZ5LJ76g/2dvbNzN68mTflzayK1umuacFcxlkehbPp6s8YuiKFCIEfdKug642wxYVYrKaIwtUtpWfJxcF+moENFLmCMRaAhwghIgI4HDOxA6j52jS+mQKG0SVHgBdSTXeDj6CW+c5gLzfN2qLGcqVRmOmB0Ga6H/a61pNBFWpQSyxWFM2yrNi9enmDAroeXEYF308Xg09hv5nJVa3cjseeJWTOjxoIzeBC3KRIFWkA9YuYzTA/Hqm5xR0BF1iTLoV3oLJqXLDViTAQ6qsbotLPppMMagURNdGfa4adl26Fd3DKrBlioaJpxi56HoI0hGpdY7oRqqL6797WTIWnDmH2rOlwC7U8ysrK8fJVKW4X30Ph2QtwC72qmjqx6NQx37HWrKyhyF0wD/v2bMPF8ycxeNAAuEMEOL3QgIdMnTIJ16+cQ48ebTaCBpyyc/iAPn16Y+f2TXCDLxRwyFuYg8zMvpBFevJ6XfIWXYJBuEXhDOPGjkFGRvOuN3niBFwqugYZmBEICXQyc+fMRMGJg83kR48XYv3GrZDBk+VD+N37pPLBAzMhi2/6gFvSXgFPTCgjkHzqMc0oZJFWYHT2CPTq1RNuUTjH0iWLksaVlIYhi7QCmzasbddaqDVeviqBLL5xYj58+ow7xfchi28UyF+zHpGICVl8ocDuvYfw4OETuMFTBT5+rsCq/HV4+Ogp3NJhChw5dgbfvlX9MZ0QdsKheUEOTThclnBw2kOHKXD0WEGiYJ3N/6WE13iynO5I/r3FXP6iKMYPt5EKnoU5DpzXpfJIKzBtnIWcKRZSQbegQgpIZfkLRiGaSOQXID4hsTNHG2WVSF8qnb3RS6RErkyuDCM1I2+dKbdJTi1wWWUQxTQdSCkg+0epQsC+znRdz2Zcl3eFfICJ+FAejUbfUFvcQJrhmA95QOUJWzAMY5SA+tzrneq24oycUdPOImOuSMwDpmmWCoaVSBPIpVjhFN4JN5wTO+euiqo7h2XT4WNo/NsSi9bsq39O9qnBAgF+2qefGiw1zdqrjeVK04R0jF9qWUqBorCR1CdGwgeQzV8hm59vWXXNnOdWB3RVDUzjqjqDCTFZgA0j0QBqmRBSCNX0T7p9ofnpnWDssR2P347HI3dbSv8LAAD//8tKOIoAAAAGSURBVAMA9jQu7w2/mZwAAAAASUVORK5CYII=';

export const ICONS: Icon[] = [
  { src: `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`, mimeType: 'image/svg+xml', sizes: ['any'] },
  { src: `data:image/png;base64,${PNG_48}`, mimeType: 'image/png', sizes: ['48x48'] },
];
