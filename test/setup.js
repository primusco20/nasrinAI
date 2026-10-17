// Mark the Node test runner as test-only before test modules import application config.
// Individual tests can still pass NODE_ENV explicitly to exercise production validation.
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
