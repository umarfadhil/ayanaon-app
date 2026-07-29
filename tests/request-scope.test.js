const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createRequestScope } = require('../src/request-scope.js');

test('isolates state between concurrent requests', async () => {
    let nextId = 0;
    const disposed = [];
    const scope = createRequestScope({
        createState: () => ({ id: ++nextId }),
        dispose: async (state) => disposed.push(state.id)
    });

    let releaseFirstRequest;
    const firstRequestBlocked = new Promise((resolve) => {
        releaseFirstRequest = resolve;
    });

    const first = scope.run(async (state) => {
        assert.equal(scope.getStore(), state);
        await firstRequestBlocked;
        return state.id;
    });
    const second = scope.run(async (state) => {
        assert.equal(scope.getStore(), state);
        releaseFirstRequest();
        return state.id;
    });

    const requestIds = await Promise.all([first, second]);
    assert.deepEqual(requestIds, [1, 2]);
    assert.deepEqual(disposed.sort(), [1, 2]);
});

test('nested work reuses one request state and disposes it once', async () => {
    let created = 0;
    let disposed = 0;
    const scope = createRequestScope({
        createState: () => ({ id: ++created }),
        dispose: async () => {
            disposed += 1;
        }
    });

    const values = await scope.run(async (outerState) => {
        const nestedId = await scope.run(async (nestedState) => {
            assert.equal(nestedState, outerState);
            return nestedState.id;
        });
        return [outerState.id, nestedId];
    });

    assert.deepEqual(values, [1, 1]);
    assert.equal(created, 1);
    assert.equal(disposed, 1);
});

test('disposes request state when request work throws', async () => {
    let disposed = false;
    const scope = createRequestScope({
        createState: () => ({}),
        dispose: async () => {
            disposed = true;
        }
    });

    await assert.rejects(
        scope.run(async () => {
            throw new Error('request failed');
        }),
        /request failed/
    );
    assert.equal(disposed, true);
});
