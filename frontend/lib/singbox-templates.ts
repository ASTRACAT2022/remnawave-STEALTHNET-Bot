export type SingboxInboundTemplate = {
  id: string;
  label: string;
  description: string;
  config: Record<string, unknown>;
};

const COMMON_ROOT = {
  log: { level: "info" },
  outbounds: [{ type: "direct", tag: "direct" }],
  route: { rules: [] as unknown[] },
};

function withInbound(inbound: Record<string, unknown>): Record<string, unknown> {
  return {
    ...COMMON_ROOT,
    inbounds: [inbound],
  };
}

export const SINGBOX_INBOUND_TEMPLATES: SingboxInboundTemplate[] = [
  {
    id: "direct",
    label: "Direct",
    description: "Inbound type direct",
    config: withInbound({ type: "direct", tag: "direct-in" }),
  },
  {
    id: "mixed",
    label: "Mixed",
    description: "SOCKS + HTTP mixed inbound",
    config: withInbound({ type: "mixed", tag: "mixed-in", listen: "::", listen_port: 1080 }),
  },
  {
    id: "socks",
    label: "SOCKS",
    description: "SOCKS5 inbound",
    config: withInbound({ type: "socks", tag: "socks-in", listen: "::", listen_port: 1081 }),
  },
  {
    id: "http",
    label: "HTTP",
    description: "HTTP proxy inbound",
    config: withInbound({ type: "http", tag: "http-in", listen: "::", listen_port: 8080 }),
  },
  {
    id: "shadowsocks",
    label: "Shadowsocks",
    description: "Shadowsocks inbound",
    config: withInbound({
      type: "shadowsocks",
      tag: "ss-in",
      listen: "::",
      listen_port: 8388,
      method: "chacha20-ietf-poly1305",
      users: [{ name: "user1", password: "change-me" }],
    }),
  },
  {
    id: "vmess",
    label: "VMess",
    description: "VMess inbound",
    config: withInbound({
      type: "vmess",
      tag: "vmess-in",
      listen: "::",
      listen_port: 10086,
      users: [{ name: "user1", uuid: "11111111-1111-1111-1111-111111111111" }],
    }),
  },
  {
    id: "trojan",
    label: "Trojan",
    description: "Trojan inbound",
    config: withInbound({
      type: "trojan",
      tag: "trojan-in",
      listen: "::",
      listen_port: 443,
      users: [{ name: "user1", password: "change-me" }],
      tls: {
        enabled: true,
        server_name: "example.com",
        certificate_path: "/etc/ssl/certs/fullchain.pem",
        key_path: "/etc/ssl/private/privkey.pem",
      },
    }),
  },
  {
    id: "naive",
    label: "Naive",
    description: "Naive inbound",
    config: withInbound({
      type: "naive",
      tag: "naive-in",
      listen: "::",
      listen_port: 443,
      users: [{ username: "user1", password: "change-me" }],
      tls: {
        enabled: true,
        server_name: "example.com",
        certificate_path: "/etc/ssl/certs/fullchain.pem",
        key_path: "/etc/ssl/private/privkey.pem",
      },
    }),
  },
  {
    id: "hysteria2",
    label: "Hysteria2",
    description: "Hysteria2 inbound",
    config: withInbound({
      type: "hysteria2",
      tag: "hy2-in",
      listen: "::",
      listen_port: 8443,
      users: [{ name: "user1", password: "change-me" }],
      tls: {
        enabled: true,
        server_name: "example.com",
        certificate_path: "/etc/ssl/certs/fullchain.pem",
        key_path: "/etc/ssl/private/privkey.pem",
      },
    }),
  },
  {
    id: "shadowtls",
    label: "ShadowTLS",
    description: "ShadowTLS inbound",
    config: withInbound({
      type: "shadowtls",
      tag: "shadowtls-in",
      listen: "::",
      listen_port: 8444,
      version: 3,
      password: "change-me",
      handshake: { server: "example.com", server_port: 443 },
    }),
  },
  {
    id: "tuic",
    label: "TUIC",
    description: "TUIC inbound",
    config: withInbound({
      type: "tuic",
      tag: "tuic-in",
      listen: "::",
      listen_port: 10443,
      users: [
        {
          name: "user1",
          uuid: "11111111-1111-1111-1111-111111111111",
          password: "change-me",
        },
      ],
      congestion_control: "bbr",
      tls: {
        enabled: true,
        alpn: ["h3"],
        certificate_path: "/etc/ssl/certs/fullchain.pem",
        key_path: "/etc/ssl/private/privkey.pem",
      },
    }),
  },
  {
    id: "hysteria",
    label: "Hysteria",
    description: "Hysteria inbound",
    config: withInbound({
      type: "hysteria",
      tag: "hy-in",
      listen: "::",
      listen_port: 9443,
      users: [{ name: "user1", password: "change-me" }],
      up_mbps: 100,
      down_mbps: 100,
      tls: {
        enabled: true,
        certificate_path: "/etc/ssl/certs/fullchain.pem",
        key_path: "/etc/ssl/private/privkey.pem",
      },
    }),
  },
  {
    id: "anytls",
    label: "AnyTLS",
    description: "AnyTLS inbound",
    config: withInbound({
      type: "anytls",
      tag: "anytls-in",
      listen: "::",
      listen_port: 443,
      users: [{ name: "user1", password: "change-me" }],
      padding_scheme: ["stop=8", "0=30-60"],
      tls: {
        enabled: true,
        certificate_path: "/etc/ssl/certs/fullchain.pem",
        key_path: "/etc/ssl/private/privkey.pem",
      },
    }),
  },
  {
    id: "vless",
    label: "VLESS",
    description: "VLESS inbound",
    config: withInbound({
      type: "vless",
      tag: "vless-in",
      listen: "::",
      listen_port: 443,
      users: [{ name: "user1", uuid: "11111111-1111-1111-1111-111111111111" }],
      tls: {
        enabled: true,
        server_name: "example.com",
        certificate_path: "/etc/ssl/certs/fullchain.pem",
        key_path: "/etc/ssl/private/privkey.pem",
      },
    }),
  },
  {
    id: "tun",
    label: "Tun",
    description: "TUN inbound",
    config: withInbound({
      type: "tun",
      tag: "tun-in",
      interface_name: "tun0",
      inet4_address: ["172.19.0.1/30"],
      auto_route: true,
    }),
  },
  {
    id: "redirect",
    label: "Redirect",
    description: "Redirect inbound",
    config: withInbound({
      type: "redirect",
      tag: "redirect-in",
      listen: "::",
      listen_port: 12345,
    }),
  },
  {
    id: "tproxy",
    label: "TProxy",
    description: "Transparent proxy inbound",
    config: withInbound({
      type: "tproxy",
      tag: "tproxy-in",
      listen: "::",
      listen_port: 12346,
    }),
  },
];

export function getSingboxTemplateById(id: string): SingboxInboundTemplate | undefined {
  return SINGBOX_INBOUND_TEMPLATES.find((template) => template.id === id);
}
