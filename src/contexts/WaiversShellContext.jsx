import React, { createContext, useContext, useMemo } from 'react';

const WaiversShellContext = createContext({ fullWidth: false, hideModuleDeactivation: false });

export function WaiversShellProvider({ fullWidth = false, hideModuleDeactivation = false, children }) {
  const value = useMemo(
    () => ({ fullWidth: !!fullWidth, hideModuleDeactivation: !!hideModuleDeactivation }),
    [fullWidth, hideModuleDeactivation]
  );
  return (
    <WaiversShellContext.Provider value={value}>{children}</WaiversShellContext.Provider>
  );
}

/** When inside Clover waivers shell, expand page/content wrappers to full tab width. */
export function useWaiversShellStyle(style) {
  const { fullWidth } = useContext(WaiversShellContext);
  if (!fullWidth || !style) return style ?? {};

  const next = {
    ...style,
    width: '100%',
    maxWidth: '100%',
  };

  if (style.margin === '0 auto') {
    next.margin = 0;
  }
  if (style.marginLeft === 'auto' || style.marginRight === 'auto') {
    next.marginLeft = 0;
    next.marginRight = 0;
  }

  return next;
}

export function useWaiversShell() {
  return useContext(WaiversShellContext);
}
