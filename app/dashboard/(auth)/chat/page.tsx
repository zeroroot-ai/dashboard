import { ChatContent } from "@/components/gibson/chat/ChatContent";
import { ConversationListProvider } from "@/components/gibson/chat/ConversationListProvider";

export default function ChatPage() {
  return (
    <ConversationListProvider>
      <ChatContent />
    </ConversationListProvider>
  );
}
