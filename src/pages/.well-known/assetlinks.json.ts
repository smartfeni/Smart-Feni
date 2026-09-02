import type { APIRoute } from 'astro';

export const prerender = true;

const assetlinks = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.smartfeni.app",
      sha256_cert_fingerprints: [
        "9B:80:0E:45:D0:B2:6A:0D:C5:54:76:4F:CD:E7:7D:83:2A:E1:D6:33:88:E9:F8:95:DB:54:4E:4F:01:5F:3E:46",
        "2C:2D:25:59:5A:FF:44:48:0F:56:CF:5E:CD:53:64:99:E0:77:FA:23:1C:3E:BD:76:16:E3:96:B9:6B:BA:56:CC",
        "BD:A7:D3:50:11:A8:E7:61:B1:6D:46:26:FD:64:7E:A4:61:D7:53:54:65:86:60:47:50:53:E0:1A:A4:23:29:BF",
        "62:66:59:93:41:C7:F6:1E:EA:C3:4F:1E:12:DA:A5:25:1D:DC:E3:6D:2D:66:14:BD:AC:72:D4:43:50:7A:4A:0D"
      ]
    }
  }
];

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(assetlinks, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
};