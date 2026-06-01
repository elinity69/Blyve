import React from 'react';
import { useCall } from '../context/CallStateContext';
import { ChatCallPanel } from './ChatCallPanel';
import { GroupVoiceCallPanel } from './GroupVoiceCallPanel';
import { PinnedCallPanel } from './PinnedCallPanel';

interface ChatEmbeddedCallBarProps {
  currentUserId: string;
  conversationId?: string;
  voiceGroupId?: string;
  voiceChannelId?: string;
}

export function ChatEmbeddedCallBar({
  currentUserId,
  conversationId,
  voiceGroupId,
  voiceChannelId,
}: ChatEmbeddedCallBarProps) {
  const { callPinned, callDisplayMode, state: callState, activeCall } = useCall();

  const showPinned =
    callPinned && callState === 'in_call' && callDisplayMode === 'embedded';

  if (showPinned) {
    return <PinnedCallPanel currentUserId={currentUserId} />;
  }

  if (conversationId) {
    return <ChatCallPanel conversationId={conversationId} currentUserId={currentUserId} />;
  }

  const resolvedVoiceChannelId =
    voiceChannelId ||
    (activeCall?.isVoiceChannel && activeCall.groupId === voiceGroupId
      ? activeCall.channelId
      : null);

  if (voiceGroupId && resolvedVoiceChannelId) {
    return (
      <GroupVoiceCallPanel
        groupId={voiceGroupId}
        channelId={resolvedVoiceChannelId}
        currentUserId={currentUserId}
      />
    );
  }

  return null;
}
