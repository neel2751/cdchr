/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [new URL("https://cdc.construction/images/team/**")],
  },
};

export default nextConfig;
