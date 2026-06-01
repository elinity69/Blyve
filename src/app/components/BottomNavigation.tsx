import { MessageCircle, UserCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { NotificationBadge } from './NotificationBadge';
import { useTranslation } from 'react-i18next';
import { useUnread } from '../context/UnreadContext';
import { useState, useEffect } from 'react';

interface BottomNavigationProps {
  activeTab: 'messages' | 'profile';
  onTabChange: (tab: 'messages' | 'profile') => void;
}

export function BottomNavigation({ activeTab, onTabChange }: BottomNavigationProps) {
  const { t } = useTranslation();
  const { totalUnread, unreadByConversation } = useUnread();
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  
  // Listen for conversation open/close events to update badge
  useEffect(() => {
    const handleConversationOpened = (event: CustomEvent) => {
      setCurrentConversationId(event.detail.conversationId);
    };
    
    const handleConversationClosed = () => {
      setCurrentConversationId(null);
    };
    
    // Rely on live conversation-opened/closed events only (no stale localStorage).
    
    window.addEventListener('conversation-opened', handleConversationOpened as EventListener);
    window.addEventListener('conversation-closed', handleConversationClosed);
    
    return () => {
      window.removeEventListener('conversation-opened', handleConversationOpened as EventListener);
      window.removeEventListener('conversation-closed', handleConversationClosed);
    };
  }, []);
  
  // Calculate displayed unread count: exclude currently open conversation
  const displayedUnread = currentConversationId && unreadByConversation[currentConversationId]
    ? totalUnread - unreadByConversation[currentConversationId]
    : totalUnread;
  
  const tabs = [
    { id: 'messages' as const, icon: MessageCircle, label: t('nav.messages') },
    { id: 'profile' as const, icon: UserCircle, label: t('nav.profile') },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 md:z-50 bg-white/80 dark:bg-black/80 md:dark:bg-[#121212]/80 backdrop-blur-md border-t border-white/20 dark:border-white/5 shadow-lg">
      <div className="w-full flex justify-around items-center h-16">
        {tabs.map(({ id, icon: Icon, label }) => (
          <motion.button
            key={id}
            onClick={() => onTabChange(id)}
            className={`flex flex-col items-center justify-center flex-1 h-full transition-colors bg-transparent dark:bg-transparent relative ${
              activeTab === id
                ? 'text-blyve'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
            style={{ backgroundColor: 'transparent' }}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.1, ease: "easeOut" }}
          >
            {/* Icon Container - Feste Größe für stabiles Layout - ABSOLUT FIXIERT */}
            <div 
              className="relative flex items-center justify-center mb-0.5" 
              style={{ 
                width: '32px',
                height: '32px',
                minWidth: '32px',
                minHeight: '32px',
                maxWidth: '32px',
                maxHeight: '32px'
              }}
            >
              <Icon
                className="w-6 h-6"
                style={{
                  width: '24px',
                  height: '24px',
                  minWidth: '24px',
                  minHeight: '24px',
                  transform: activeTab === id ? 'scale(1.2)' : 'scale(1)',
                  transition: 'transform 0.3s ease',
                }}
              />
              {id === 'messages' ? (
                <NotificationBadge
                  count={displayedUnread}
                  borderClassName="border-white dark:border-black"
                />
              ) : null}
            </div>
            {/* Text - ABSOLUT FIXIERT */}
            <span 
              className="text-xs" 
              style={{ 
                fontSize: activeTab === id ? '14px' : '12px',
                lineHeight: '1',
                marginTop: '0',
                paddingTop: '0',
                fontWeight: activeTab === id ? '600' : '400',
                transition: 'font-size 0.3s ease, font-weight 0.3s ease'
              }}
            >
              {label}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
