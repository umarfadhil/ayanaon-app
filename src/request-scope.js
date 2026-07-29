const { AsyncLocalStorage } = require('node:async_hooks');

function createRequestScope({ createState, dispose }) {
    if (typeof createState !== 'function') {
        throw new TypeError('createState must be a function');
    }

    const storage = new AsyncLocalStorage();

    return {
        getStore() {
            return storage.getStore();
        },

        async run(callback) {
            if (typeof callback !== 'function') {
                throw new TypeError('callback must be a function');
            }

            const activeState = storage.getStore();
            if (activeState) {
                return callback(activeState);
            }

            const state = createState();
            return storage.run(state, async () => {
                try {
                    return await callback(state);
                } finally {
                    if (typeof dispose === 'function') {
                        await dispose(state);
                    }
                }
            });
        }
    };
}

module.exports = { createRequestScope };
