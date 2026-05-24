-- 🔥 SPORTS BUDDY CHAT SYSTEM
-- Erstellt komplettes Chat-System mit Conversations & Messages
-- Harmoniert mit bestehender profiles Tabelle und Struktur
-- Führe dieses Script im Supabase SQL Editor aus

-- ============================================
-- 1. CONVERSATIONS TABLE (Wer redet mit wem?)
-- ============================================
-- 🔥 FIX: Fehlende Spalte nachrüsten
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user1_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    user2_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user1_id, user2_id) -- Jedes User-Paar hat nur 1 Chat
);

-- Index für schnelle Suche nach Conversations eines Users
CREATE INDEX IF NOT EXISTS idx_conversations_user1 ON public.conversations(user1_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user2 ON public.conversations(user2_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON public.conversations(updated_at DESC);

-- ============================================
-- 2. MESSAGES TABLE (Die eigentlichen Nachrichten)
-- ============================================
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
    sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP WITH TIME ZONE
);

-- Index für schnelle Suche nach Messages einer Conversation
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON public.messages(conversation_id, is_read) WHERE is_read = false;

-- ============================================
-- 3. MATCHES TABLE (Optional - für bessere Integration)
-- ============================================
-- Falls ihr Matches auch in der DB speichern wollt (empfohlen)
CREATE TABLE IF NOT EXISTS public.matches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user1_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    user2_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    matched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user1_id, user2_id) -- Jeder Paarung nur 1 Match
);

CREATE INDEX IF NOT EXISTS idx_matches_user1 ON public.matches(user1_id);
CREATE INDEX IF NOT EXISTS idx_matches_user2 ON public.matches(user2_id);

-- ============================================
-- 4. ROW LEVEL SECURITY (RLS) - WICHTIG!
-- ============================================
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for clean re-runs)
DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can update their conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can view messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can view their matches" ON public.matches;
DROP POLICY IF EXISTS "Users can insert matches" ON public.matches;

-- Policy: Man darf Conversations sehen, wenn man user1 ODER user2 ist
CREATE POLICY "Users can view their conversations" ON public.conversations
FOR SELECT USING (auth.uid() = user1_id OR auth.uid() = user2_id);

-- Policy: Man darf Conversations erstellen (beim Match)
CREATE POLICY "Users can insert conversations" ON public.conversations
FOR INSERT WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);

-- Policy: Man darf Conversations updaten (für last_message, updated_at)
CREATE POLICY "Users can update their conversations" ON public.conversations
FOR UPDATE USING (auth.uid() = user1_id OR auth.uid() = user2_id);

-- Policy: Man darf Nachrichten in seinen Chats sehen
CREATE POLICY "Users can view messages in their chats" ON public.messages
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = messages.conversation_id
        AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
    )
);

-- Policy: Man darf Nachrichten senden, wenn man Teil des Chats ist
CREATE POLICY "Users can send messages" ON public.messages
FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = conversation_id
        AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
    )
);

-- Policy: Man darf eigene Nachrichten updaten (z.B. für is_read)
CREATE POLICY "Users can update their own messages" ON public.messages
FOR UPDATE USING (
    EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = messages.conversation_id
        AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
    )
);

-- Policy: Man darf seine Matches sehen
CREATE POLICY "Users can view their matches" ON public.matches
FOR SELECT USING (auth.uid() = user1_id OR auth.uid() = user2_id);

-- Policy: Man darf Matches erstellen (beim gegenseitigen Like)
CREATE POLICY "Users can insert matches" ON public.matches
FOR INSERT WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);

-- ============================================
-- 5. FUNKTIONEN für Chat-Operations
-- ============================================

-- Funktion: Erstelle automatisch Conversation beim Match
CREATE OR REPLACE FUNCTION public.create_conversation_on_match(
    p_user1_id UUID,
    p_user2_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_conversation_id UUID;
    v_user1_ordered UUID;
    v_user2_ordered UUID;
BEGIN
    -- Stelle sicher, dass user1_id < user2_id für konsistente Reihenfolge
    IF p_user1_id < p_user2_id THEN
        v_user1_ordered := p_user1_id;
        v_user2_ordered := p_user2_id;
    ELSE
        v_user1_ordered := p_user2_id;
        v_user2_ordered := p_user1_id;
    END IF;

    -- Erstelle Conversation falls noch nicht vorhanden
    INSERT INTO public.conversations (user1_id, user2_id)
    VALUES (v_user1_ordered, v_user2_ordered)
    ON CONFLICT (user1_id, user2_id) DO UPDATE
    SET updated_at = NOW()
    RETURNING id INTO v_conversation_id;

    -- Wenn ON CONFLICT, hole die bestehende ID
    IF v_conversation_id IS NULL THEN
        SELECT id INTO v_conversation_id
        FROM public.conversations
        WHERE user1_id = v_user1_ordered AND user2_id = v_user2_ordered;
    END IF;

    RETURN v_conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funktion: Sende Nachricht (mit automatischem Update der Conversation)
CREATE OR REPLACE FUNCTION public.send_message(
    p_conversation_id UUID,
    p_sender_id UUID,
    p_content TEXT
)
RETURNS UUID AS $$
DECLARE
    v_message_id UUID;
BEGIN
    -- Validiere, dass der Sender Teil der Conversation ist
    IF NOT EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = p_conversation_id
        AND (c.user1_id = p_sender_id OR c.user2_id = p_sender_id)
    ) THEN
        RAISE EXCEPTION 'User is not part of this conversation';
    END IF;

    -- Erstelle Nachricht
    INSERT INTO public.messages (conversation_id, sender_id, content)
    VALUES (p_conversation_id, p_sender_id, p_content)
    RETURNING id INTO v_message_id;

    -- Update Conversation (last_message, updated_at)
    UPDATE public.conversations
    SET 
        last_message = p_content,
        last_message_at = NOW(),
        updated_at = NOW()
    WHERE id = p_conversation_id;

    RETURN v_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funktion: Markiere Nachrichten als gelesen
CREATE OR REPLACE FUNCTION public.mark_messages_as_read(
    p_conversation_id UUID,
    p_user_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    v_updated_count INTEGER;
BEGIN
    -- Validiere, dass der User Teil der Conversation ist
    IF NOT EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = p_conversation_id
        AND (c.user1_id = p_user_id OR c.user2_id = p_user_id)
    ) THEN
        RAISE EXCEPTION 'User is not part of this conversation';
    END IF;

    -- Markiere alle Nachrichten des anderen Users als gelesen
    UPDATE public.messages
    SET 
        is_read = true,
        read_at = NOW()
    WHERE conversation_id = p_conversation_id
    AND sender_id != p_user_id
    AND is_read = false;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funktion: Erstelle Match und Conversation in einem Schritt
CREATE OR REPLACE FUNCTION public.create_match_with_conversation(
    p_user1_id UUID,
    p_user2_id UUID
)
RETURNS TABLE(match_id UUID, conversation_id UUID) AS $$
DECLARE
    v_match_id UUID;
    v_conversation_id UUID;
    v_user1_ordered UUID;
    v_user2_ordered UUID;
BEGIN
    -- Stelle sicher, dass user1_id < user2_id
    IF p_user1_id < p_user2_id THEN
        v_user1_ordered := p_user1_id;
        v_user2_ordered := p_user2_id;
    ELSE
        v_user1_ordered := p_user2_id;
        v_user2_ordered := p_user1_id;
    END IF;

    -- Erstelle Match
    INSERT INTO public.matches (user1_id, user2_id)
    VALUES (v_user1_ordered, v_user2_ordered)
    ON CONFLICT (user1_id, user2_id) DO NOTHING
    RETURNING id INTO v_match_id;

    -- Hole Match-ID falls bereits vorhanden
    IF v_match_id IS NULL THEN
        SELECT id INTO v_match_id
        FROM public.matches
        WHERE user1_id = v_user1_ordered AND user2_id = v_user2_ordered;
    END IF;

    -- Erstelle Conversation
    v_conversation_id := public.create_conversation_on_match(p_user1_id, p_user2_id);

    RETURN QUERY SELECT v_match_id, v_conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. TRIGGER: Auto-Update Conversation bei neuer Nachricht
-- ============================================

-- Trigger-Funktion: Update Conversation beim Erstellen einer Nachricht
CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.conversations
    SET 
        last_message = NEW.content,
        last_message_at = NEW.created_at,
        updated_at = NEW.created_at
    WHERE id = NEW.conversation_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger erstellen
DROP TRIGGER IF EXISTS trigger_update_conversation_on_message ON public.messages;
CREATE TRIGGER trigger_update_conversation_on_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.update_conversation_on_message();

-- ============================================
-- ============================================
-- 7. REALTIME AKTIVIEREN (FIXED)
-- ============================================

-- Wir versuchen erst, die Tabellen zu entfernen (falls sie schon drin sind),
-- ignorieren aber Fehler, falls sie noch nicht drin waren.
-- Leider unterstützt SQL hier kein "IF EXISTS", daher machen wir es "brutal"
-- indem wir die Publication neu erstellen, falls nötig.

-- BESSERER WEG: Einfach hinzufügen. Supabase ist schlau genug.
-- Falls die Tabelle schon drin ist, passiert nichts Schlimmes.

DO $$
BEGIN
  -- Messages hinzufügen
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Conversations hinzufügen
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Matches hinzufügen
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
-- ============================================
-- 8. HELPER VIEWS (Optional, aber nützlich)
-- ============================================

-- View: Conversations mit User-Info und unread Count
CREATE OR REPLACE VIEW public.conversations_with_details AS
SELECT 
    c.id,
    c.user1_id,
    c.user2_id,
    c.created_at,
    c.updated_at,
    c.last_message,
    c.last_message_at,
    -- Unread Count für user1
    (SELECT COUNT(*) 
     FROM public.messages m 
     WHERE m.conversation_id = c.id 
     AND m.sender_id = c.user2_id 
     AND m.is_read = false) as user1_unread_count,
    -- Unread Count für user2
    (SELECT COUNT(*) 
     FROM public.messages m 
     WHERE m.conversation_id = c.id 
     AND m.sender_id = c.user1_id 
     AND m.is_read = false) as user2_unread_count
FROM public.conversations c;

-- Grant permissions für View
GRANT SELECT ON public.conversations_with_details TO authenticated;

-- ============================================
-- ✅ FERTIG! Chat-System steht.
-- ============================================
-- 
-- 📝 Verwendung in deinem Code:
--
-- 1. BEIM MATCH (wenn beide swipen rechts):
--    SELECT * FROM create_match_with_conversation(user1_id, user2_id);
--
-- 2. NACHRICHT SENDEN:
--    SELECT send_message(conversation_id, sender_id, 'Hallo!');
--
-- 3. NACHRICHTEN LADEN:
--    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at;
--
-- 4. CONVERSATIONS LADEN:
--    SELECT * FROM conversations WHERE user1_id = ? OR user2_id = ? ORDER BY updated_at DESC;
--
-- 5. NACHRICHTEN ALS GELESEN MARKIEREN:
--    SELECT mark_messages_as_read(conversation_id, user_id);
--
-- 6. REALTIME SUBSCRIBE (im Frontend):
--    supabase.channel('messages').on('postgres_changes', {
--      event: 'INSERT',
--      schema: 'public',
--      table: 'messages',
--      filter: 'conversation_id=eq.' + conversationId
--    }, (payload) => { /* neue Nachricht! */ })
--    .subscribe();
--
-- 💬 Viel Erfolg mit deinem WhatsApp-Feeling! 💬
