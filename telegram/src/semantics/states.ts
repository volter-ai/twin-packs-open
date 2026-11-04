// Telegram's state machines (architecture, "State"). One field the demand reaches moves: a chat member's `status`,
// which people move in the Telegram app (the World's doors stand in for it: a chat made, a member added, promoted or
// removed). A bot's API moves none of it in this pack's scope (promoteChatMember, banChatMember, leaveChat are not
// served). A message is made and deleted, an update queued and confirmed (deleted), a file stored: none has a state.
const MEMBER = 'https://core.telegram.org/bots/api#chatmember';
const MEMBER_BANNED = 'https://core.telegram.org/bots/api#chatmemberbanned';

export const states = {
  chat_member: {
    state: {
      // source: https://core.telegram.org/bots/api#chatmember "Currently, the following 6 types of chat members are supported"
      status: {
        // a person or bot never in the chat answers as one who left: "isn't currently a member of the chat"
        initial: 'left',
        transitions: [
          // the person who makes a chat is its owner
          // source: https://core.telegram.org/bots/api#chatmemberowner "Represents a chat member that owns the chat and has all administrator privileges."
          { actor: 'external' as const, from: ['left'], to: 'creator', source: `${MEMBER} "ChatMemberOwner"` },
          // a member added by a person in the app (or one who joins a public chat)
          // source: https://core.telegram.org/bots/api#chatmembermember "Represents a chat member that has no additional privileges or restrictions."
          { actor: 'external' as const, from: ['left', 'kicked'], to: 'member', source: `${MEMBER} "ChatMemberMember"` },
          // added as an administrator, or promoted
          // source: https://core.telegram.org/bots/api#chatmemberadministrator "Represents a chat member that has some additional privileges."
          { actor: 'external' as const, from: ['left', 'member', 'kicked'], to: 'administrator', source: `${MEMBER} "ChatMemberAdministrator"` },
          // removed by an administrator: banned, it cannot come back by itself
          // source: https://core.telegram.org/bots/api#chatmemberbanned "Represents a chat member that was banned in the chat and can't return to the chat or view chat messages."
          { actor: 'external' as const, from: ['member', 'administrator'], to: 'kicked', source: `${MEMBER_BANNED} "can't return to the chat"` },
        ],
        // Not declared, as no step asks for them: an administrator demoted to a member, and a member leaving by itself
        // (left: "isn't currently a member of the chat, but may join it themselves", https://core.telegram.org/bots/api#chatmemberleft);
        // the doors do not offer them, and leaveChat and promoteChatMember are not served.
      },
    },
  },
  // a chat's `type` (private, group, supergroup, channel) is its kind, fixed when it is made
  // source: https://core.telegram.org/bots/api#chat "Type of the chat, can be either"
  chat: { notState: ['type'] },
};
