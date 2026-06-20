/**
 * Global DOM Inspect Snapshot Utility
 * Prefix: [DOM SNAPSHOT DEBUG]
 */

export function takeDomSnapshot(triggerEvent: string) {
  if (typeof window === 'undefined') return;

  const ts = performance.now();
  const activeElement = document.activeElement;
  const activeElementDesc = activeElement
    ? `${activeElement.tagName.toLowerCase()}${activeElement.id ? '#' + activeElement.id : ''}${activeElement.className ? '.' + Array.from(activeElement.classList).join('.') : ''}`
    : 'none';

  const iframes = Array.from(document.querySelectorAll('iframe'));
  const dialogs = document.querySelectorAll('[role="dialog"]');
  const fixedOverlays = document.querySelectorAll('.fixed, .absolute');
  
  // Sichtbare topbars per data-attr/class/tag
  const topbars = Array.from(document.querySelectorAll('[data-topbar], .topbar, header, [class*="topbar"]')).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  // Sichtbare call containers
  const callContainers = Array.from(document.querySelectorAll('[data-call-container], [class*="call-container"], #jitsi-meet-container')).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  // Sichtbare pip containers
  const pipContainers = Array.from(document.querySelectorAll('[data-pip-drag-handle], [class*="pip-container"]')).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  // Suspicious pointer-events elements (blockers, scrims, panels with pointer-events: auto/none)
  const suspiciousLayers: Array<{ selector: string; pointerEvents: string; isVisible: boolean }> = [];
  const layerSelectors = [
    '[class*="scrim"]',
    '[class*="blocker"]',
    '[class*="overlay"]',
    '[class*="panel"]',
    '[class*="transition"]',
    '[class*="swipe"]',
  ];
  layerSelectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      const style = window.getComputedStyle(el);
      const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
      if (style.pointerEvents !== 'none' || isVisible) {
        let name = el.tagName.toLowerCase();
        if (el.id) name += `#${el.id}`;
        if (el.className) name += `.${Array.from(el.classList).join('.')}`;
        suspiciousLayers.push({
          selector: name,
          pointerEvents: style.pointerEvents,
          isVisible,
        });
      }
    });
  });

  console.group(`[DOM SNAPSHOT DEBUG] Event: ${triggerEvent} | ts: ${ts.toFixed(2)}ms`);
  console.log(`Active Element:`, activeElementDesc);
  console.log(`Iframe Count: ${iframes.length}`, iframes.map(f => f.src || 'about:blank'));
  console.log(`Dialog (role="dialog") Count: ${dialogs.length}`);
  console.log(`Fixed/Absolute elements: ${fixedOverlays.length}`);
  console.log(`Sichtbare Topbars (${topbars.length}):`, topbars.map(el => {
    return `${el.tagName.toLowerCase()}.${Array.from(el.classList).join('.')}`;
  }));
  console.log(`Sichtbare Call Containers (${callContainers.length}):`, callContainers.map(el => {
    return `${el.tagName.toLowerCase()}.${Array.from(el.classList).join('.')}`;
  }));
  console.log(`Sichtbare PiP Containers (${pipContainers.length}):`, pipContainers.map(el => {
    return `${el.tagName.toLowerCase()}.${Array.from(el.classList).join('.')}`;
  }));
  console.log(`Pointer-Events suspects (scrims/blockers/overlays/panels):`, suspiciousLayers.slice(0, 15));
  console.groupEnd();
}
