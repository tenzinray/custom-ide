

in the pi chat where the tab buttons are at the top that have chat name / x to close chat, lets have small indicator left of name to show if chats turn is in progress with something moving like primary blue spinner same color as chat links or if it completed with green check. completed show if completion hasnt been seen yet, once i click over to that chat no longer needs check and if im focused on the chat / its visible, doesnt need completed or in progress thing. keep it performant.

the "dont scroll on new incoming msg when im scrolled up" in pi chat isn't working it yanks me down even if im above the don't scroll down position.

scroll janks around too when a turn is in progress images in that turn disapear and reapear as new event come in to that turn. actually images disapear/apear in the entire visible chat not just in current turn. was introduced when images preview were added to pi chat. should be more performant if the issue is tht new event in turn rerenders entire chat .. solution of solving intense layout shifts should not introduce new layout shift jank. 



## pi changes
- [ ] Upgrade Pide’s bundled Pi runtime from 0.84.1 to 1.5.2 or newest after, updating pi-coding-agent and pi-ai as a compatible set. Preserve custom pi extensions and Audit SDK and pide integration breaking changes. something already looked into that might need some finessing: SessionManager-owned history, event/session-entry shapes (including context_edit), custom-provider transcripts, turn startup/cancellation, tool-schema validation, and our internal auth-storage import. Validate existing-session resume, streaming, Stop, steering, compaction, account switching, and MCP tools in dev before updating installed Pide.

Then set up something that helps auto keep up with pi updates so we dont fall so far behind again and ensure updates dont break shit in pide or my extensions. ideas? im not in love with periodic timer triggered agent wake up checks but soemthing like this could work, def dont want a random convo to be interupted and agent to be like fuck what you wwanna work on a new pi update is avialable because then ill just always defer it.


Background tasks: revisit [pi-bg-tasks](https://github.com/cyzlmh/pi-extensions/tree/main/pi-bg-tasks) so long-running commands can run in the background while Pi keeps working, then deliver completion/output at the next safe point or wake an idle session. Reuse the extension if suitable; update our chat bridge to keep listening for later session events and display wake-ups.

Sub agents.


## not urgent
somehow indicate to agent where my msg was sent. so agent knows if my msg was sent though pide dev chat ui, pide prod chat ui, pide dev or prod terminal or somewhere else. this was agent knows. but i dont want each response to contain extra text in the full context or if thats best way then ensure the text is small and simple. agent only needs to know "where was last msg sent from?" not where was each msg in entire convo sent from.
