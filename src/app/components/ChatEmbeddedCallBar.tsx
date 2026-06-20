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
  isActive?: boolean;
}

export function ChatEmbeddedCallBar({
  currentUserId,
  conversationId,
  voiceGroupId,
  voiceChannelId,
  isActive = true,
}: ChatEmbeddedCallBarProps) {
  const { callPinned, callDisplayMode, state: callState, activeCall, callHostTarget, transitionToEmbeddedInConversation } = useCall();

  const isCallConv = conversationId && activeCall && activeCall.conversationId === conversationId;

  React.useEffect(() => {
    if (!isActive || callState !== 'in_call' || !activeCall) return;

    if (isCallConv) {
      if (callDisplayMode !== 'embedded' || !callHostTarget || callHostTarget.type !== 'chat') {
        console.log(`[CALL AUTO TRANSITION] Entering call conversation ${conversationId}. Transitioning to embedded.`);
        transitionToEmbeddedInConversation(conversationId, 'auto-enter-chat');
      }
    } else if (callPinned && conversationId) {
      if (callDisplayMode !== 'embedded' || !callHostTarget || callHostTarget.type !== 'pinned-global') {
        console.log(`[CALL AUTO TRANSITION] Entering another conversation ${conversationId} while pinned. Transitioning to pinned-global.`);
        transitionToEmbeddedInConversation(conversationId, 'auto-enter-pinned');
      }
    }
  }, [isActive, callState, activeCall, isCallConv, callPinned, callDisplayMode, callHostTarget, conversationId, transitionToEmbeddedInConversation]);

  const showPinned =
    isActive &&
    callPinned &&
    callState === 'in_call' &&
    callDisplayMode === 'embedded' &&
    !isCallConv &&
    (!!conversationId || !!voiceGroupId);

  console.log(`[CALL DEBUG] ChatEmbeddedCallBar evaluation: conversationId=${conversationId}, callPinned=${callPinned}, callState=${callState}, callDisplayMode=${callDisplayMode}, isCallConv=${isCallConv}, showPinned=${showPinned}`);

  if (showPinned) {
    console.log(`[CALL DEBUG] ChatEmbeddedCallBar rendering PinnedCallPanel.`);
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
