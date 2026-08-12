import type { APIRoute } from 'astro';

export const prerender = true;

const assetlinks = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.smartfeni.app",
      sha256_cert_fingerprints: [
        "9B:80:0E:45:D0:B2:6A:0D:C5:54:76:4F:CD:E7:7D:83:2A:E1:D6:33:88:E9:F8:95:DB:54:4E:4F:01:5F:3E:46"
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