// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { ChatContent } from "@/components/gibson/chat/ChatContent";
import { ConversationListProvider } from "@/components/gibson/chat/ConversationListProvider";

export default function ChatPage() {
  return (
    <ConversationListProvider>
      <ChatContent />
    </ConversationListProvider>
  );
}
