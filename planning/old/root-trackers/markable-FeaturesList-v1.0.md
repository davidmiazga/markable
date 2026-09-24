# Features

We will have 3 categories of features:

1. Base-Core features (!important always a priority, warn if anything impacts this)
   
   a. Extended features (building upon Base-core and can be bumped to a plugin as needed)

2. Plugin features (allows the app to be performant while adding optinal features)

3. PKM features (Personal Knowledge Management)

## Feature Checkpoint 1: Base features

1. Editing experience: A 'Typora' feel where users edit inline markdown in a 'windowless' environment. Basic markdown buttons in this view with a palette of type tools.

2. Performance: Focus on a very fast opening and editing experience. App should open almost instantly. No flashes of white windows or flashing of other UI elements. Anything that cannot be loaded quickly will have to be loaded either as a secondary load or be shuttled to the 'Added-Plugin' state of loading.

3. Basic interface controls (in settings)
   
   1. Settings are always persistant. The app should open in the same state the user left it. Core settings include:
      
      1. Customizable content width
      
      2. Customizable default overall font size.
      
      3. Customizable keyboard commands and save user presets.
      
      4. Custom css is persistant on load
      
      5. Window placement is persistant on load
      
      6. Recent files is persistant on load

4. Customization: Advanced theming, a hot-swapaple (think vscode's experience) and user-editable (via a css directory in the users package alongside the app or in the users app settings, please advise on the proper location). This means users should be able to quickly switch themes. Also they should be able to make their own themes by adding a simple css file to this directory.
   
   

5. Base menu UI: Look at these menu items which implies features here... All typical mac app features should be present (and the default Keyboard Shortcut is listed):
   
   1. System menu items: 
      
      1. About Markable
      
      2. Check for updates... (opens url)
      
      3. Settings: Cmd-,
      
      4. Hide Markable: Cmd-H
      
      5. Show all
      
      6. Quit: Cmd-Q
   
   2. All 'File' menu items:
      
      1. Open: Cmd-O
      
      2. New file: Cmd-N
      
      3. Save: Cmd-S
      
      4. Save As: Cmd-Shift-S
      
      5. Export: Cmd-Opt-E
      
      6. Import: Cmd-I
      
      7. Close: Cmd-W
      
      8. Close All: Cmd-Shift-W
   
   3. Edit:
      
      1. Undo: Cmd-Z
      
      2. Redo: Cmd-Shift-Z
      
      3. Cut: Cmd-X
      
      4. Copy: Cmd-C
      
      5. Paste: Cmd-V
      
      6. Paste Link Over Text: Cmd-K
      
      7. Copy As Markdown: Cmd-Shift-C
      
      8. Copy As HTML: Cmd-Opt-C
      
      9. Paste Without Formatting: Cmd-Shift-V
      
      10. Select All: Cmd-A
      
      11. Find: Cmd-F
      
      12. Find And Replace: Cmd-Shift-F
      
      13. Move line up: Opt-Up Arrow
      
      14. Move line down: Opt-Down Arrow
   
   4. Format:
      
      1. Headings -> H1:Cmd-1, H2:Cmd-2, H3:Cmd-3, H4:Cmd-4, H5:Cmd-5, H6:Cmd-6
      
      2. Text -> Bold: Cmd-B, Italic: Cmd-I, Underline: Cmd-U, Superscript: Cmd-Shift-+, Subscript: Cmd-Shift--, Highlight: Cmd-Shift-H, Math: Cmd-Shift-M, Strikethrough: Cmd-Shift-<, 
      
      3. Insert Image: Cmd-E
      
      4. Insert Link Format: Cmd-Shift-[
      
      5. Insert Table: Cmd-Shift-T
      
      6. Code Fences: Opt-C
      
      7. Quote: Opt-Q
      
      8. Math: Opt-M
      
      9. Ordered List -> Simple Numerals: Opt-O, 
      
      10. Indent: Cmd-]
      
      11. Outdent: Cmd-[
      
      12. Bullet List: Opt-.
      
      13. Task List: Opt-x
      
      14. Horizontal Rule: Opt-/
      
      15. Front Matter Fence: Cmd-Shift-Y
      
      16. Clear All Formatting: Cmd-.
   
   5. Theme
      
      1. Next Theme: Ctrl-Shift-Down Arrow
      
      2. Previous Theme: Ctrl-Shift-Up Arrow
      
      3. ...<Theme-List>,,,
   
   6. Window
      
      1. Zoom In: Cmd-+
      
      2. Zoom Out: Cmd--
      
      3. Fullscreen: Ctrl-F
      
      4. Maximize
      
      5. Minimize
   
   7. Help
      
      1. Search
      
      2. Quickstart
      
      3. Help
      
      4. Markdown Cheatsheet

## Feature Checkpoint 2: Plugin Features

#### Optionally installed by user. These features are only to be considered after base features are verified as working.

1. Markdown Toolbar (editable position - floating, float offset, custom position or docked at top like MSword)

2. Word-count

3. Auto generate TOC (Table of Contents)

4. Basic templates (markdown with fields for reuse)

5. Advanced Lists: Roman Numerals: Opt-R, Number Letter Simple: Opt-N, Number Letter Extended: Opt-L (Custom Formats?)

6. Advanced markdown like tables

7. Advanced preview inserting of media (Images, Video, .md, )

8. Math Latex support

9. Diagrams support: Mermaid diagram support or excalidraw (or separate into separate plugins)

10. Focus modes: Focus General mode - keeps current line highlighted. Typewriter mode - also keeps current line in center of screen

11. Command bar (Cmd-Shift-P)

12. Multi-cursor (Cmd-Opt-Up/down arrows)

13. Backlinks (+Visualization?)

14. Footnotes

15. Insert count command (Insert a number and increment by 1 - or start an input number and count by X).

16. Extended Exports: PDF, HTML, MSword formats
    
    ... other popular Obsidian features

## Feature Checkpoint 3: Advanced PKM Features

#### (These will take more time to implement but this puts Markable in competition with Obisidan) -

#### FYI: This list will probably never be complete

1. Daily note - Calendar

2. Yaml pane (auto tagging, categories)

3. Extended keyboard command interface that is top-notch

4. Custom Icons

5. Advanced CSS class support (for inserting user html or simple features like columns)

6. Columns - prebuilt column support. This is very difficult because it has to mix markdown and html/css. I am sure there is a way to do it better and support it in a way that doesn't break things.

7. Dockable interface for top/bottom/left/right pane areas

8. Page preview (again like MS-word were we can see a page edge on all sides)

9. File Browser (pane on left shows files, very similar to vscode with custom icons)

10. Layout views/templates 

11. File Browser Advanced (Special features like the ability to have 'Vaults' like Obsidian)
    
    1. Content type hierarchy (Vault, Areas-Divisions, Domains, Fields, Subfields, Disciplines, Subjects, Topics, Subtopics, Snippets, )
    
    2. Folder View (that has a customized view a folder of content, this would be a custom view of the items inside a hierachy item (above).

12. Backup & Sync

13. Networking solutions (inserting file paths that are on local networks or on a different OS)

14. Projects

15. Dataview (Sortable Tables with filters) - THIS WOULD BE HUGE!!!
    
    1. Excel and basic spreadsheet support?

16. Advanced import (Be able to read and write MS office formats would be huge)

17. Full Excalidraw support

18. Maybe... Slides/presentation support? How huge would that be? This would require alot of custom CSS-ability.
