const base = require('./webpack.main.config');

// The legacy hardware package's type declarations are incompatible with its
// TypeScript version. Keep runtime dependencies external, as Entry Offline does.
module.exports = {
    ...base,
    externals: [
        ...base.externals,
        function(_, request, callback) {
            if (!request.startsWith('.') && !require('path').isAbsolute(request)) {
                return callback(null, `commonjs ${request}`);
            }
            callback();
        },
    ],
    module: {
        rules: [{
            test: /\.(ts|tsx)$/,
            exclude: /node_modules/,
            use: [{ loader: 'ts-loader', options: { transpileOnly: true } }],
        }],
    },
};
