import { TabState, $imports } from '../../src/background/tab-state';

describe('TabState', () => {
  let state;
  let onChange;

  beforeEach(() => {
    onChange = sinon.spy();
    state = new TabState(
      {
        1: { state: 'active' },
      },
      onChange
    );
  });

  it('can be initialized without any default state', () => {
    assert.doesNotThrow(() => {
      state = new TabState(null, onChange);
      state.isTabActive(1);
    });
  });

  it('can be initialized without an onchange callback', () => {
    assert.doesNotThrow(() => {
      state = new TabState();
      state.isTabActive(1);
    });
  });

  describe('#load', () => {
    it('replaces the current tab states with a new object', () => {
      state.load({ 2: { state: 'inactive' } });
      // `load` (re)sets all tabs to their default state, which is inactive
      assert.equal(state.isTabActive(1), false);
      assert.equal(state.isTabInactive(2), true);
    });
  });

  describe('#activateTab', () => {
    it('sets the state for the tab id provided', () => {
      state.activateTab(2);
      assert.equal(state.isTabActive(2), true);
    });

    it('triggers an onchange handler', () => {
      state.activateTab(2);
      assert.calledWith(onChange, 2, sinon.match({ state: 'active' }));
    });
  });

  describe('#deactivateTab', () => {
    it('sets the state for the tab id provided', () => {
      state.deactivateTab(2);
      assert.equal(state.isTabInactive(2), true);
    });

    it('triggers an onchange handler', () => {
      state.deactivateTab(2);
      assert.calledWith(onChange, 2, sinon.match({ state: 'inactive' }));
    });
  });

  describe('#errorTab', () => {
    it('sets the state for the tab id provided', () => {
      state.errorTab(2);
      assert.equal(state.isTabErrored(2), true);
    });

    it('triggers an onchange handler', () => {
      state.errorTab(2);
      assert.calledWith(onChange, 2, sinon.match({ state: 'errored' }));
    });
  });

  describe('#clearTab', () => {
    it('removes the state for the tab id provided', () => {
      state.clearTab(1);
      assert.equal(
        state.isTabActive(1),
        false,
        'expected isTabActive to return false'
      );
      assert.equal(
        state.isTabInactive(1),
        true,
        'expected isTabInactive to return true'
      );
      assert.equal(
        state.isTabErrored(1),
        false,
        'expected isTabInactive to return false'
      );
    });

    it('triggers an onchange handler', () => {
      state.clearTab(1);
      assert.calledWith(onChange, 1, undefined);
    });
  });

  describe('#isTabActive', () => {
    it('returns true if the tab is active', () => {
      state.activateTab(1);
      assert.equal(state.isTabActive(1), true);
    });
  });

  describe('#isTabInactive', () => {
    it('returns true if the tab is inactive', () => {
      state.deactivateTab(1);
      assert.equal(state.isTabInactive(1), true);
    });
  });

  describe('#isTabErrored', () => {
    it('returns true if the tab is errored', () => {
      state.errorTab(1, new Error('Some error'));
      assert.equal(state.isTabErrored(1), true);
    });
  });

  describe('#setState', () => {
    it('clears the error when not errored', () => {
      state.errorTab(1, new Error('Some error'));
      assert.ok(state.getState(1).error instanceof Error);
      state.setState(1, { state: 'inactive' });
      assert.notOk(state.getState(1).error);
    });
  });

  describe('#updateAnnotationCount', () => {
    let clock;
    let fetchAnnotationCountStub;
    let uriForBadgeRequestStub;
    const INITIAL_WAIT_MS = 1000;
    const MAX_WAIT_MS = 3000;
    const CACHE_EXPIRATION_MS = 3000;

    beforeEach(() => {
      clock = sinon.useFakeTimers();
      fetchAnnotationCountStub = sinon.stub();
      uriForBadgeRequestStub = sinon.stub().returnsArg(0);
      $imports.$mock({
        './uri-info': {
          fetchAnnotationCount: fetchAnnotationCountStub,
          uriForBadgeRequest: uriForBadgeRequestStub,
        },
      });
    });

    afterEach(() => {
      $imports.$restore();
      clock.restore();
    });

    it("doesn't query the service for invalid URLs", async () => {
      const testValue = 42;
      fetchAnnotationCountStub.resolves(testValue);
      uriForBadgeRequestStub.throws('any error');
      const tabState = new TabState({ 1: { state: 'active' } });

      const promise = tabState.updateAnnotationCount(1, 'invalidOrblocked');
      clock.tick(INITIAL_WAIT_MS);

      await promise;
      assert.notCalled(fetchAnnotationCountStub);
      assert.equal(tabState.getState(1).annotationCount, 0);
    });

    it('updates the annotationCount (immediately) if previous URL query is still in the cache', async () => {
      const firstValue = 33;
      const secondValue = 41;
      fetchAnnotationCountStub.onCall(0).resolves(firstValue);
      fetchAnnotationCountStub.onCall(1).resolves(secondValue);
      const tabState = new TabState({
        1: { state: 'active' },
        2: { state: 'active' },
      });

      const promise1 = tabState.updateAnnotationCount(1, 'http://foobar.com');
      clock.tick(INITIAL_WAIT_MS);

      await promise1;
      assert.calledOnce(fetchAnnotationCountStub);
      assert.equal(tabState.getState(1).annotationCount, firstValue);

      // During the second request the URL is still in the cache
      // It updates the immediately (no wait), and for different tabs
      const promise2 = tabState.updateAnnotationCount(1, 'http://foobar.com');
      const promise3 = tabState.updateAnnotationCount(2, 'http://foobar.com');

      await promise2;
      await promise3;
      assert.calledOnce(fetchAnnotationCountStub);
      assert.equal(tabState.getState(1).annotationCount, firstValue);
      assert.equal(tabState.getState(2).annotationCount, firstValue);

      // During the third request the URL is not in the cache anymore
      clock.tick(CACHE_EXPIRATION_MS);
      const promise4 = tabState.updateAnnotationCount(1, 'http://foobar.com');
      clock.tick(INITIAL_WAIT_MS);

      await promise4;
      assert.calledTwice(fetchAnnotationCountStub);
      assert.equal(tabState.getState(1).annotationCount, secondValue);
      assert.equal(tabState.getState(2).annotationCount, firstValue);
    });

    it('updates the annotationCount (after waiting period) if previous URL query is still in the cache', async () => {
      const testValue = 33;
      const WAIT_FETCH = 500; // Takes 2000ms to return a response
      fetchAnnotationCountStub.returns(
        new Promise(resolve => setTimeout(() => resolve(testValue), WAIT_FETCH))
      );

      const tabState = new TabState({
        1: { state: 'active' },
        2: { state: 'active' },
      });

      // This is the scenario:
      //                         wait   fetch
      // Request from tab 1   |--------||---|
      // Request from tab 2        |--------|

      const promise1 = tabState.updateAnnotationCount(1, 'http://foobar.com');
      clock.tick(INITIAL_WAIT_MS);

      assert.calledOnce(fetchAnnotationCountStub);
      assert.equal(tabState.getState(1).annotationCount, 0);

      // The second request comes from another tab, hence it is not cancelled.
      // At this point the cache is empty
      const promise2 = tabState.updateAnnotationCount(2, 'http://foobar.com');
      clock.tick(WAIT_FETCH);
      await promise1;
      assert.equal(tabState.getState(1).annotationCount, testValue);
      assert.equal(tabState.getState(2).annotationCount, 0);

      // By the time the request from the second tab finish the waiting period,
      // the cache has the value and it skips the fetching of the badge count.
      clock.tick(WAIT_FETCH);
      await promise2;
      assert.calledOnce(fetchAnnotationCountStub);
      assert.equal(tabState.getState(2).annotationCount, testValue);
    });

    it(`queries the service and sets the annotation count after waiting for a period of ${INITIAL_WAIT_MS}ms`, async () => {
      const testValue = 42;
      fetchAnnotationCountStub.resolves(testValue);
      const tabState = new TabState({ 1: { state: 'active' } });

      const promise = tabState.updateAnnotationCount(1, 'http://foobar.com');
      clock.tick(INITIAL_WAIT_MS);

      await promise;
      assert.called(fetchAnnotationCountStub);
      assert.equal(tabState.getState(1).annotationCount, testValue);
    });

    it(`resolves last request after a maximum of ${MAX_WAIT_MS}ms when several requests are made in succession to the service`, async () => {
      const testValue = 42;
      fetchAnnotationCountStub.resolves(testValue);
      const tabState = new TabState({ 1: { state: 'active' } });

      // Simulate several URL changes in rapid succession
      const start = Date.now();
      let done;
      for (let i = 0; i < 10; i++) {
        done = tabState.updateAnnotationCount(1, 'http://foobar.com');
      }
      await clock.runToLastAsync();
      await done;
      const end = Date.now();

      // all pending requests are canceled except the last one which is resolved in no more than MAX_WAIT_MS
      assert.equal(end - start, MAX_WAIT_MS);
      assert.calledOnce(fetchAnnotationCountStub);
      assert.equal(tabState.getState(1).annotationCount, testValue);
    });

    it('cancels the first query (during waiting stage) when the service is called two consecutive times for the same tab', async () => {
      const initialValue = 33;
      const testValue = 42;
      fetchAnnotationCountStub.resolves(testValue);
      const tabState = new TabState({
        1: { state: 'active', annotationCount: initialValue },
      });

      const promise1 = tabState.updateAnnotationCount(1, 'http://foobar.com');
      const promise2 = tabState.updateAnnotationCount(1, 'http://foobar.com'); // promise 1 is still waiting when promise2 is called
      assert.equal(tabState.getState(1).annotationCount, initialValue);
      clock.tick(MAX_WAIT_MS);

      await promise1;
      await promise2;
      assert.calledOnce(fetchAnnotationCountStub);
      assert.equal(tabState.getState(1).annotationCount, testValue);
    });

    it('cancels the first query (during the fetch stage) when the service is called two consecutive times for the same tab', async () => {
      const initialValue = 33;
      const testValue = 42;

      const WAIT_FETCH = 2000; // Takes 2000ms to return a response
      fetchAnnotationCountStub.returns(
        new Promise(resolve => setTimeout(() => resolve(testValue), WAIT_FETCH))
      );

      const tabState = new TabState({
        1: { state: 'active', annotationCount: initialValue },
      });

      const promise1 = tabState.updateAnnotationCount(1, 'http://foobar.com');
      clock.tick(INITIAL_WAIT_MS); // promise1 finished waiting and it is fetching the request
      const promise2 = tabState.updateAnnotationCount(1, 'http://foobar.com');
      assert.equal(tabState.getState(1).annotationCount, initialValue);
      clock.tick(MAX_WAIT_MS + WAIT_FETCH);

      await promise1;
      await promise2;
      assert.calledTwice(fetchAnnotationCountStub); // request is not cancelled
      assert.equal(tabState.getState(1).annotationCount, testValue);
    });

    it('resolves two concurrent requests if they are made for different tabs', async () => {
      const testValue = 42;
      fetchAnnotationCountStub.resolves(testValue);

      const tabState = new TabState({
        1: { state: 'active' },
        2: { state: 'active' },
      });

      const promise1 = tabState.updateAnnotationCount(1, 'http://foobar.com');
      const promise2 = tabState.updateAnnotationCount(2, 'http://foobar.com');
      clock.tick(INITIAL_WAIT_MS);

      await promise1;
      await promise2;
      assert.calledTwice(fetchAnnotationCountStub);
      assert.equal(tabState.getState(1).annotationCount, testValue);
      assert.equal(tabState.getState(2).annotationCount, testValue);
    });

    it('sets the annotation count to zero if badge request is rejected', async () => {
      fetchAnnotationCountStub.rejects('some error condition');

      const tabState = new TabState({
        1: { state: 'active', annotationCount: 33 },
      });

      const promise = tabState.updateAnnotationCount(1, 'http://foobar.com');
      clock.tick(MAX_WAIT_MS);

      await promise;
      assert.equal(tabState.getState(1).annotationCount, 0);
    });
  });
});
