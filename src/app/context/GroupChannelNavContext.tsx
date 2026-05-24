import React from 'react';

/** Lets GroupThreadScreen read the active channel when rendered inside a mobile overlay (stale closure). */
export const GroupChannelNavContext = React.createContext<{
  channelId: string | null;
  groupId: string | null;
  channelName: string | null;
  channelIconUrl: string | null;
}>({ channelId: null, groupId: null, channelName: null, channelIconUrl: null });
