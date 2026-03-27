/** @type {import('next').NextConfig} */
const nextConfig = {
	webpack: (config, { dev }) => {
		if (dev) {
			// Avoid flaky .next/cache file rename failures on some Windows setups.
			config.cache = { type: "memory" };
		}
		return config;
	},
};

export default nextConfig;
