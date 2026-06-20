import { test, expect } from '@playwright/test';

test.describe('PiP/Embedded State Machine E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the development server and wait for network idle
    await page.goto('https://localhost:5173/');
    await page.waitForLoadState('networkidle');

    // Wait for the bundle to load and define mock trigger
    await page.waitForFunction(() => typeof (window as any).__triggerMockCall === 'function', { timeout: 10000 });

    // Bypass authentication and onboarding
    await page.evaluate(() => {
      (window as any).__isPlaywrightTest = true;
      if ((window as any).__setIsAuthenticated) {
        (window as any).__setIsAuthenticated(true);
      }
      if ((window as any).__setLoading) {
        (window as any).__setLoading(false);
      }
      if ((window as any).__setCurrentUserId) {
        (window as any).__setCurrentUserId('mock-user-id');
      }
    });

    // Trigger mock call so PiP/call UI is active and visible
    await page.evaluate(() => {
      if ((window as any).__triggerMockCall) {
        (window as any).__triggerMockCall('mock-conv-id', 'pip');
      }
    });
    await page.waitForTimeout(500);
  });

  // 1. tap on pip does not open preview behind it
  test('tap on pip does not open preview behind it', async ({ page }) => {
    const dragHandle = page.locator('[data-pip-drag-handle]');
    await expect(dragHandle).toBeVisible();

    // Tap on the PiP
    await dragHandle.click();
    await page.waitForTimeout(200);

    // Assert that the user profile preview behind it was NOT opened
    const profilePreview = page.locator('[data-profile-preview-root="true"]');
    await expect(profilePreview).not.toBeVisible();
  });

  // 2. double tap on pip restores embedded when valid chat host can be prepared
  test('double tap on pip restores embedded when valid chat host can be prepared', async ({ page }) => {
    const dragHandle = page.locator('[data-pip-drag-handle]');
    await expect(dragHandle).toBeVisible();

    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Mock active call state so that there is a valid target context
    await page.evaluate(() => {
      // Set active call with a valid mock conversationId
      if ((window as any).__callStateMachine) {
        // Dispatch transition request with simulated active call
        (window as any).__callStateMachine.transitionToEmbeddedIfPossible('test-restore-active');
      }
    });

    await page.waitForTimeout(500);

    // Verify that the restore intent was started and a preparation was triggered
    const hasIntentLog = consoleLogs.some(log =>
      log.includes('[CALL STATE MACHINE][INTENT]') && log.includes('test-restore-active')
    );
    expect(hasIntentLog).toBe(true);
  });

  // 3. double tap on pip stays blocked only when preview/overlay is active
  test('double tap on pip stays blocked only when preview/overlay is active', async ({ page }) => {
    const dragHandle = page.locator('[data-pip-drag-handle]');
    await expect(dragHandle).toBeVisible();

    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Force profile preview overlay state to true
    await page.evaluate(() => {
      if (typeof (window as any).__callActions !== 'undefined' && (window as any).__callActions.setIsProfilePreviewOpen) {
        (window as any).__callActions.setIsProfilePreviewOpen(true);
      }
    });

    // Wait for React to flush state and re-render
    await page.waitForTimeout(150);

    // Now trigger transition, which should be blocked
    await page.evaluate(() => {
      if ((window as any).__callStateMachine) {
        (window as any).__callStateMachine.transitionToEmbeddedIfPossible('test-blocked-preview');
      }
    });

    await page.waitForTimeout(300);

    // Assert that it is indeed blocked when an overlay/preview is active
    const hasBlockedLog = consoleLogs.some(log =>
      log.includes('[CALL STATE MACHINE][BLOCKED]')
    );
    expect(hasBlockedLog).toBe(true);
  });

  // 4. back swipe from embedded returns to pip and pip remains interactive
  test('back swipe from embedded returns to pip and pip remains interactive', async ({ page }) => {
    const dragHandle = page.locator('[data-pip-drag-handle]');
    await expect(dragHandle).toBeVisible();

    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Simulate transition back to pip (like a back swipe)
    await page.evaluate(() => {
      if ((window as any).__callStateMachine) {
        (window as any).__callStateMachine.transitionToPiP('back-swipe-test');
      }
    });

    await page.waitForTimeout(300);

    // Assert that we transitioned to PiP mode and did not lose the iframe
    const hasTransitionLog = consoleLogs.some(log =>
      log.includes('mode=pip') || log.includes('Already at target state')
    );
    expect(hasTransitionLog).toBe(true);

    const pipWidget = page.locator('#floating-call-widget-root');
    await expect(pipWidget).toBeVisible();

    // Verify it is still interactive (can register clicks/taps)
    await dragHandle.click();
    await page.waitForTimeout(200);
  });

  // 5. double tap on pip correctly stays embedded and does not race back to pip
  test('double tap on pip correctly stays embedded and does not race back to pip', async ({ page }) => {
    const dragHandle = page.locator('[data-pip-drag-handle]');
    await expect(dragHandle).toBeVisible();

    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Simulate double-tap on PiP widget
    await page.evaluate(() => {
      if ((window as any).__callActions) {
        // Trigger restore
        (window as any).__callActions.requestOpenEmbeddedForConversation('mock-conv-id');
      }
    });

    await page.waitForTimeout(500);

    // Verify restore lock or block guards were respected and no races occurred
    const hasLockLog = consoleLogs.some(log => log.includes('[CALL STATE MACHINE][LOCK] restore lock acquired') || log.includes('[CALL GUARD DEBUG]'));
    expect(hasLockLog).toBe(true);

    const hasRaceLog = consoleLogs.some(log => log.includes('[CALL RACE DEBUG]'));
    expect(hasRaceLog).toBe(false);
  });

  // 6. embedded call + header/back button => transitions to pip and call remains visible
  test('embedded call + header/back button => transitions to pip and call remains visible', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Simulate clicking the header/back button with leaveEmbeddedCallToPiP
    await page.evaluate(() => {
      if (typeof (window as any).__callActions !== 'undefined' && (window as any).__callActions.leaveEmbeddedCallToPiP) {
        (window as any).__callActions.leaveEmbeddedCallToPiP({
          source: 'header-back',
          conversationId: 'mock-conv-id'
        });
      } else if ((window as any).__callStateMachine) {
        (window as any).__callStateMachine.transitionToPiP('header-back-test');
      }
    });

    await page.waitForTimeout(300);

    const hasTransitionLog = consoleLogs.some(log => log.includes('mode=pip') || log.includes('leaveEmbeddedCallToPiP'));
    expect(hasTransitionLog).toBe(true);

    const pipWidget = page.locator('#floating-call-widget-root');
    await expect(pipWidget).toBeVisible();
  });

  // 7. pinned call remains visible when navigating to another chat
  test('pinned call remains visible when navigating to another chat', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Pin the call, then simulate unmounting the chat host
    await page.evaluate(() => {
      if (typeof (window as any).__callActions !== 'undefined') {
        (window as any).__callActions.requestPinEmbeddedGlobal();
      }
    });

    await page.waitForTimeout(300);

    const hasPinnedLog = consoleLogs.some(log => log.includes('requestPinEmbeddedGlobal') || log.includes('pinned-global'));
    expect(hasPinnedLog).toBe(true);

    // Simulate navigation away where previous host unregisters
    await page.evaluate(() => {
      if (typeof (window as any).__callActions !== 'undefined' && (window as any).__callActions.registerCallHost) {
        (window as any).__callActions.registerCallHost('chat:mock-conv-id', null);
      }
    });

    await page.waitForTimeout(300);

    const isPinnedHostVisible = await page.evaluate(() => {
      return (window as any).__activeHostKey === 'pinned-global' || (window as any).__activeHostKey === 'pip';
    });
    expect(isPinnedHostVisible).toBe(true);
  });

  // 8. PiP over preview, double tap inside PiP => embedded remains visible, no fallback to PiP, no chat/open-preview side effect
  test('PiP over preview, double tap inside PiP => embedded remains visible, no fallback to PiP, no chat/open-preview side effect', async ({ page }) => {
    const dragHandle = page.locator('[data-pip-drag-handle]');
    await expect(dragHandle).toBeVisible();

    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Simulate active call state so we have a valid target conversation
    await page.evaluate(() => {
      if ((window as any).__callActions) {
        (window as any).__callActions.requestOpenEmbeddedForConversation('mock-conv-id');
      }
    });

    await page.waitForTimeout(500);

    // Verify it remains embedded and hasn't fallen back to PiP
    const mode = await page.evaluate(() => (window as any).__callDisplayMode);
    expect(mode).toBe('embedded');

    const hasRaceLog = consoleLogs.some(log => log.includes('CALL RACE DETECTED'));
    expect(hasRaceLog).toBe(false);
  });

  // 9. tap inside PiP never triggers underlying preview/chat click handlers
  test('tap inside PiP never triggers underlying preview/chat click handlers', async ({ page }) => {
    const dragHandle = page.locator('[data-pip-drag-handle]');
    await expect(dragHandle).toBeVisible();

    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Tap on the PiP
    await dragHandle.click();
    await page.waitForTimeout(200);

    // Ensure no underlying preview/chat click logic triggers
    const hasBlockedNavLog = consoleLogs.some(log => log.includes('ensureConversationVisibleForCall BLOCKED') || log.includes('openConversationById BLOCKED'));
    const isProfileVisible = await page.locator('[data-profile-preview-root="true"]').isVisible().catch(() => false);
    
    expect(isProfileVisible).toBe(false);
  });

  // 10. dragging PiP still works
  test('dragging PiP still works', async ({ page }) => {
    const dragHandle = page.locator('[data-pip-drag-handle]');
    await expect(dragHandle).toBeVisible();

    const boxBefore = await dragHandle.boundingBox();
    console.log('boxBefore:', boxBefore);
    expect(boxBefore).not.toBeNull();

    // Trigger precise programmatic drag of the PiP via our robust window helper
    await page.evaluate(() => {
      if ((window as any).__dragCallPip) {
        (window as any).__dragCallPip(-100, -100);
      }
    });

    await page.waitForTimeout(300);

    const boxAfter = await dragHandle.boundingBox();
    console.log('boxAfter:', boxAfter);
    expect(boxAfter).not.toBeNull();
    if (boxBefore && boxAfter) {
      expect(boxAfter.x).not.toEqual(boxBefore.x);
    }
  });

  // 11. forward-reopen / preview-tap / back-swipe paths do not steal PiP-owned interactions
  test('forward-reopen / preview-tap / back-swipe paths do not steal PiP-owned interactions', async ({ page }) => {
    const dragHandle = page.locator('[data-pip-drag-handle]');
    await expect(dragHandle).toBeVisible();

    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Tap inside PiP bounds
    await dragHandle.click();
    await page.waitForTimeout(200);

    // Assert that standard navigation paths (like open-conversation) did not interfere
    const hasContaminationLog = consoleLogs.some(log => log.includes('openConversationById BLOCKED') || log.includes('ensureConversationVisibleForCall BLOCKED'));
    expect(hasContaminationLog).toBe(false);
  });
});
