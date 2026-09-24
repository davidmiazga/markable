# PKM features

**Overview**: This is the group of features that make this app special. Each features stands apart and builds or extends from features found in other apps. 

The over-arching theme for the PKM features will be the 'Power of 3' approach: 1. in (things that are input) 2. working (where humans and AI do the bulk of their work to summarize, encapsulate or otherwise add value) 3. out (output of the process that can provide features and benefits for others to consume - and possibly put into another 'in' process for another work process to build from). 

** Performance ** 
This can live all in one vault, or separate vaults, or however the user feels will be most helpful. We should always encourage the user (potentially with the help of AI) to start to separate content when it gets to ~400 items because above 500 is when the typical computer will have trouble with performance.

** Detail **
The 'Power of 3' is summarized  in further detail as:
1. ** in: Resource Library**: Collecting info and using AI to organize it into a library of Categories, Tags, etc. This libary will also have the Power of 3 inside of it.
    a. in: Raw source files (pdf, txt, md, html, video, books... any format that contains info). No structure or subfolders. Everything is here in it's original format.
    b. working: Notes (atomic or summary or both). Anything that summarizes, categories encouraged. These are our library 'shelves'. Tags and other metadata is encouraged. Original media can be embedded for convenience. Diagrams and drawings can live here as a summary.
    c. out: Summaries that can are ready for handoff for consuming in other parts of this system, especially for projects. These are considered 'briefs' (shorter summaries, like a 1-pager) that are the starting point for input into another job, task or personal learning.
2. ** working: Personal Continous Learning**: Using info and combining it with rituals such as 'Daily Notes', a Diary or other interactions with the info to make it personal to the user. This also breaks down into the 'Power of 3' system in this manner:
    a. in: Summaries and random clippings of a personal nature that are not meant to be informative (those go into the previous section: 'Resource Library'). They can be for aethetics, saved as memorabilia, bookmarks for reading, books for reading, or otherwise of personal interest for users.
    b. working: Any writing, drawing, or other user activity. Examples are: Daily notes, Calendar, To-dos, Shoppping lists/research, Digital books currently being read, Journaling, etc.
    c. out: Completed items are archived here. Daily notes, Journals, Shopping research that is no longer needed at this time... all of it can be archived in an archive format (encouraged to be archived by year... always.)
3. ** out: Projects**: Using resources/info to support a specific purpose or project. This also follows the 'Power of 3' format:
    a. in: A common 'toolshed' that informs and has items needed for all projects. Examples include: Fonts, Colors, Templates, Inspiration, Input from our 'Research Library', etc.
    b. Working: Working Projects are broken out into 'Clients' folders. Each client has their own folder (in an abbreviation format of AB-Abbreviation) and that folder is full of projects that are for that client list in a simple 3 digit sequential number and each job start with two digits for the year.
    ie. FL-FirstLast
        -26FL-001-FriendlyNameCamelCase
            -in (source files for project)
            -jobWorking (where any work or manipulating of files is done)
            -out (where finished works are stored)
    c. out: Archive of previous years projects. Users will be encouraged to use compression where appropriate (jobs older than 3 years). Each job can be compressed separately to protect against corruption. Jobs older than 5-10 years can be stored offline or in accorance with a separate archive plan (combination of offsite and onsite backups encouraged).

This 'Power of 3' approach is never forced upon users. Instead, it is simply suggested in some documentation that we will add later (users can do whatever they want). They will choose other PKM methods (such as CORE, PARA, Zelltekasten, etc) and these tools will also support that. Our PKM features will be tools centered around (but not limited to) the File Browser plugin and will help facilitate tasks in this overview.

## Features
### File Browser enhancements
1. Stacks: A sidebar treatment that 'stacks' items and the user can see only a portion of the files directly. This is meant as a quick place to store items into a group for sorting out later. On click, instead of opening like a folder there is a stack view that let's the user see some of the contents before opening in the content area (open to suggestions).
2. Shelves (Grid): Meant to be more visual like a bookshelf. Meant to store larger collections or larger .md files. When clicked the content area becomes a visual stack of books where we can see the names of 'books' or groups of files. We can also have several view modes here (grid, lists, book 'stack', carousel view, card view, filmstrip view, etc). 
3. Shelf Collections: Building on the shelf treatment. This however, is more of a place where users can put things based on meta-data. User can put what they want here manually but it is really intended that the system do this automatically by 'generating' (running a script) to gather things into this location automatically based on yaml or other meta-data (filters set up by the user). 
4. Notecards: Meant for small md files that can be pointers to other files (backlinked). Very useful for atomic note-taking and these can have a visual style that lends themselves to quick yaml input, footnotes, and shorter content.
5. Cabinets: Much like a vault where users can store larger groups of things.
6. Boards: I am not sure of the tech (Excalidraw? Mermaid extension?) but a place where users can have a canvas that enables multiple notes to be put onto a 'surface' and connections or graphics can be added. 
7. Image Vaults: Here we get into thumbnails and galleries for visual people. Much like adobe bridge this is an attempt to empower visual people and get them into the meta-data and pointer files. Boards and Shelves will be prominently featured and further made easy to get into. Meta-data/yaml will be readily available and ready to edit. Video is supported and tools for note-taking on top of images and video should be considered. Filtering and sorting should be available too.

### Key PKM differentiators
1. Data visualizations: The obsidian 'Graph view' is the starting point. I would like to push beyond that and offer several view types. I will provide examples (Venn diagrams, Innovative Bar Charts, Level string graphs, etc.) LMK what tech Obsidian uses (is it threejs?). I am sure there are limitations but this will really be worth it once we have something cool implemented - all users love this feature and we will really go above and beyond... at least that's the goal).
2. AI tools: The ability for AI to help organize and maintain a good PKM will be key. Some people are already saying that an app is no longer needed because AI can make an app for you. I say, why waste time and tokens when we have an awesome interface to organize and see your PKM? I want it to be 100% plug and play. I am not even sure we need an API. We can (and should consider), an approach like vscode where we provide a terminal and the user brings their own AI (Claude-code, or other).
3. Dashboards: I would like use to research the typical Claude, OpenClaw, Hermes, and other AI-made dashboards that users have done out there. It should list and have cards/display for agents, key metrics, token usage (if applicable), Calendar/Chron jobs, Daily results from Agent reports, etc. It should be customizable by the AI but we will have a default (and a reset in case the AI or user messes it up). We can/should consider letting the AI spin this off into it's own app that the user can open without opening up 'Markable' - but we will show how the app is enhanced with context from the PKM data should the user decide to open up the dashboard inside of 'Markable'.

### Out of the box features (do not do these, just reseach and LMK thoughts)
1. MSword replement: If we could open/save MSword format, it could be a complete victory for users wanting to ditch that experience. Let's face it, that format is old and tired. However, it is very customizable. While markdown has styles to keep things consistent, MSword has the ability to style text as the user sees fit. I would think a combination of both would be really attractive. Also, being able to see and edit page breaks, insert images, and output a proper pdf would be amazing.

2. Slide deck: Speaking of MSword, how about Powerpoint. Again, this is old and I know there are .md solutions for slides but this again would really entice users.

3. Spreadsheets: Ok, I am on a microsoft spree here but we already have some really cool table features that mimic much of what a typical user does in excel. Again, the formatting issues and a lack of proper spreadsheet features might hold us back. However, if we could at least import/export an excel file and get close, I think this would take over the dominance of our app and .md in general.