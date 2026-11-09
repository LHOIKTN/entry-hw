// Entry Offline embeds the router, preload and selection UI together.
const main = require('./webpack.beomeo-main.config');
const preload = require('./webpack.preload.config');
const renderer = require('./webpack.renderer.config');
module.exports = [main, preload, renderer].map(config => ({
    ...config,
    module: {
        ...config.module,
        rules: config.module.rules.map(rule => ({
            ...rule,
            ...(Array.isArray(rule.use) ? { use: rule.use.map(loader => loader.loader === 'ts-loader'
                ? { ...loader, options: { ...loader.options, transpileOnly: true } } : loader) } : {}),
        })),
    },
}));
