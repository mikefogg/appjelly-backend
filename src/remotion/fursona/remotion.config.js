import { Config } from '@remotion/cli/config';

// Set the Webpack polling if on WSL
if (process.platform === 'linux' && process.env.WSL_DISTRO_NAME) {
  Config.setWebpackPollingInMilliseconds(1000);
}

// Set output location
Config.setOutputLocation('out/video.mp4');

// Increase timeout for longer renders
Config.setTimeoutInMilliseconds(300000); // 5 minutes

// Set concurrency for faster rendering
Config.setConcurrency(4);

// Override any Webpack configuration
Config.overrideWebpackConfig((currentConfiguration) => {
  return {
    ...currentConfiguration,
    module: {
      ...currentConfiguration.module,
      rules: [
        ...currentConfiguration.module.rules,
        // Add any custom loaders here
      ],
    },
  };
});