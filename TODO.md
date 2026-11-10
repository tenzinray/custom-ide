




allowing multiples panes in the secondary chat panel so that instead of me dragging a chat into the normal place where files and shit display i could have switchable tabs and or split view of chats within that secondary panel


I want a small display of the email of the acccount im logged in on in my chatgpt account in the bottom left under the input, left of the repo path. it should be pressable and when pressed it shows dropdown to change to diff open ai account with another option to add new account to login and auth within pi . purpose is to allow me to easily switch between open ai accounts quickly/instantly in pi . idealy it handles any refresh needed so i dont have to refresh anything manually and entire window doesnt need to close / reopen for the pi/caht to be connected to newsly selected acount . also i dont wanna need to reauth for accoutns already logged in previusly. for add new account of course we need the pi auth flow the web one same shit pi terminal thing uses . might need pi config changes . think we might have already set this up idk . also the repo badge under input we should change it so just display repo name not full path . only display full path if the project is NOT the normal repo root so if project isnt in vscode/ folder there. the limits thing in top of chat should refresh on new account when accounts change to .

Background tasks: revisit [pi-bg-tasks](https://github.com/cyzlmh/pi-extensions/tree/main/pi-bg-tasks) so long-running commands can run in the background while Pi keeps working, then deliver completion/output at the next safe point or wake an idle session. Reuse the extension if suitable; update our chat bridge to keep listening for later session events and display wake-ups.
