/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      new URL("https://cdc.construction/images/team/**"),
      new URL("https://hrcdc.s3.eu-west-2.amazonaws.com/**"),
    ],
  },
};

export default nextConfig;
