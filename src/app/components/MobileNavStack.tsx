import React, {

  createContext,

  useCallback,

  useContext,

  useEffect,

  useLayoutEffect,

  useMemo,

  useRef,

  useState,

} from 'react';

import { NavigationStack } from './NavigationStack';

import { navDebug } from '../lib/navDebug';

import { useMobileViewportDriver } from '../hooks/useMobileViewportInsets';

import { MOBILE_VV_CSS } from '../lib/mobileViewport';

import { clearNavSwipeLocks } from '../lib/navigationShellStyle';



export interface PushScreenOptions {

  skipEnterAnimation?: boolean;

  fromForward?: boolean;

}



export interface MobileNavStackApi {

  pushScreen: (content: React.ReactNode, id?: string, options?: PushScreenOptions) => void;

  popScreen: () => void;

  clearStack: () => void;

  stackDepth: number;

}



export interface MobileNavStackProps {

  /** List layer rendered by parent when overlayOnly is true. */

  preview?: React.ReactNode;

  /** When true, list stays in tab flow; this stack only mounts the sliding overlay. */

  overlayOnly?: boolean;

  children?: React.ReactNode;

  onStackChange?: (stackDepth: number) => void;
  onBeforePop?: () => void;
  onSwipeBackStart?: () => void;
  onSwipeBackEnd?: () => void;
  apiRef?: React.MutableRefObject<MobileNavStackApi | null>;
}



const MobileNavStackContext = createContext<MobileNavStackApi | null>(null);



export function useMobileNavStack(): MobileNavStackApi {

  const api = useContext(MobileNavStackContext);

  if (!api) {

    throw new Error('useMobileNavStack must be used within <MobileNavStack>');

  }

  return api;

}



interface StackEntry {

  id: string;

  content: React.ReactNode;

  skipEnterAnimation?: boolean;

}



const listLayerStyle: React.CSSProperties = {

  position: 'absolute',

  inset: 0,

  zIndex: 0,

  backgroundColor: 'var(--color-background, #0d0d0d)',

  overflow: 'hidden',

  transform: 'translateZ(0)',

};



const viewportStyle: React.CSSProperties = {

  position: 'fixed',

  top: `var(${MOBILE_VV_CSS.offsetTop}, 0px)`,

  left: 0,

  right: 0,

  boxSizing: 'border-box',

  height: `calc(var(${MOBILE_VV_CSS.height}, 100dvh) + var(${MOBILE_VV_CSS.bottomInset}, 0px))`,

  paddingBottom: `var(${MOBILE_VV_CSS.bottomInset}, 0px)`,

  overflow: 'hidden',

  zIndex: 1,

  backgroundColor: 'transparent',

  pointerEvents: 'none',

};



export function MobileNavStack({

  preview,

  overlayOnly = false,

  children,

  onStackChange,
  onBeforePop,
  onSwipeBackStart,
  onSwipeBackEnd,
  apiRef,
}: MobileNavStackProps) {

  const [overlay, setOverlay] = useState<StackEntry | null>(null);

  const overlayRef = useRef<StackEntry | null>(null);

  overlayRef.current = overlay;



  const stackIdCounter = useRef(0);

  const onStackChangeRef = useRef(onStackChange);

  const listLayerRef = useRef<HTMLDivElement | null>(null);



  onStackChangeRef.current = onStackChange;



  useMobileViewportDriver(true);



  const notifyDepth = useCallback((depth: number, stackIds: string[]) => {

    navDebug.log('stack', 'depth/change', { depth, stackIds });

    onStackChangeRef.current?.(depth);

    if (depth > 0) {

      window.dispatchEvent(new CustomEvent('mobile-chat-stack-open'));

    } else {

      window.dispatchEvent(new CustomEvent('mobile-chat-stack-close'));

    }

  }, []);



  const pushScreen = useCallback(

    (content: React.ReactNode, id?: string, options?: PushScreenOptions) => {

      const screenId = id || `screen-${++stackIdCounter.current}`;

      navDebug.log('stack', 'pushScreen', {

        screenId,

        skipEnterAnimation: options?.skipEnterAnimation ?? false,

      });

      const entry: StackEntry = {

        id: screenId,

        content,

        skipEnterAnimation: options?.skipEnterAnimation,

      };

      setOverlay(entry);

      notifyDepth(1, [screenId]);

    },

    [notifyDepth],

  );



  const popScreen = useCallback(() => {

    if (!overlayRef.current) return;

    navDebug.log('stack', 'popScreen', {});

    clearNavSwipeLocks();

    setOverlay(null);

    notifyDepth(0, []);

  }, [notifyDepth]);



  const clearStack = useCallback(() => {

    navDebug.log('stack', 'clearStack', {});

    clearNavSwipeLocks();

    setOverlay(null);

    notifyDepth(0, []);

  }, [notifyDepth]);



  const stackDepth = overlay ? 1 : 0;



  const api = useMemo<MobileNavStackApi>(

    () => ({

      pushScreen,

      popScreen,

      clearStack,

      stackDepth,

    }),

    [pushScreen, popScreen, clearStack, stackDepth],

  );



  useLayoutEffect(() => {

    if (apiRef) {

      apiRef.current = api;

    }

  }, [api, apiRef]);



  useLayoutEffect(() => {

    if (overlayOnly || overlay) return;

    const list = listLayerRef.current;

    if (!list) return;

    list.style.pointerEvents = 'auto';

    list.style.visibility = 'visible';

    list.style.opacity = '1';

    void list.offsetHeight;

  }, [overlay, overlayOnly]);



  useEffect(() => {

    navDebug.log('stack', 'render-state', {

      stackDepth,

      stackIds: overlay ? [overlay.id] : [],

      overlay: overlay ? `stack:${overlay.id}` : 'none',

      overlayOnly,

      listInteractive: !overlay,

    });

  }, [overlay, overlayOnly, stackDepth]);



  const handlePanelBack = useCallback(() => {
    requestAnimationFrame(() => {
      popScreen();
    });
  }, [popScreen]);



  const showViewport = overlayOnly ? overlay != null : true;



  return (

    <MobileNavStackContext.Provider value={api}>

      {showViewport ? (

        <div

          data-nav-stack-viewport

          data-nav-overlay={overlay ? `stack:${overlay.id}` : 'none'}

          data-nav-stack-depth={stackDepth}

          style={{

            ...viewportStyle,

            pointerEvents: overlay ? 'auto' : 'none',

          }}

        >

          {!overlayOnly ? (

            <div

              ref={listLayerRef}

              data-nav-list-layer

              data-messages-preview-shell

              style={{

                ...listLayerStyle,

                pointerEvents: overlay ? 'none' : 'auto',

                touchAction: overlay ? 'none' : 'pan-y',

              }}

            >

              {preview}

            </div>

          ) : null}



          {overlay ? (

            <NavigationStack
              key={overlay.id}
              screenId={overlay.id}
              skipEnterAnimation={overlay.skipEnterAnimation}
              onBeforeBack={onBeforePop}
              onSwipeBackStart={onSwipeBackStart}
              onSwipeBackEnd={onSwipeBackEnd}
              onBack={handlePanelBack}
            >

              {overlay.content}

            </NavigationStack>

          ) : null}

        </div>

      ) : null}

      {children}

    </MobileNavStackContext.Provider>

  );

}


