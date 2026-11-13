# Shared windows and dialogs

This pass compares the window frame, caption buttons, menu bars, scrollbars,
the window menu, common controls, message boxes, property sheets, and the
Open and Save As dialogs with the original XP SP3 VM at 1024×768. Notepad,
Taskbar and Start Menu Properties, Date and Time Properties, the Run error,
and Save As were the reference windows.

## Reference

The local VM was run with `bun run xp:vm -- --instance areas` using a
disposable snapshot. The app was captured in headless Chromium at the same
1024×768 viewport, with each window moved to the VM window's position.
Measurements were taken from pixel rows and columns of both captures.

| View               | VM                                   | App                                   |
| ------------------ | ------------------------------------ | ------------------------------------- |
| Notepad            | `xp-notepad-1024x768.png`            | `app-notepad-1024x768.jpg`            |
| Notepad, scrolled  | `xp-notepad-scrolled-1024x768.png`   | `app-notepad-scrolled-1024x768.jpg`   |
| Window menu        | `xp-system-menu-1024x768.png`        | `app-system-menu-1024x768.jpg`        |
| Taskbar properties | `xp-taskbar-properties-1024x768.png` | `app-taskbar-properties-1024x768.jpg` |
| Date and Time      | `xp-date-time-1024x768.png`          | `app-date-time-1024x768.jpg`          |
| Save As            | `xp-save-as-1024x768.png`            | `app-save-as-1024x768.jpg`            |
| Run error          | `xp-run-error-1024x768.png`          | `app-run-error-1024x768.jpg`          |

## Matched

- Window frames are drawn from Luna.msstyles for Blue, Olive Green, and
  Silver: a 30px caption sliced with the theme's 28/35/9/17 sizing margins,
  4px side and bottom edges, the maximized caption, and no drop shadow. The
  frame columns, caption rows, and bottom rows match the VM pixel for pixel.
- Caption buttons use each scheme's own button and glyph bitmaps, 2px apart,
  6px from the top and right edges. Title text uses the theme's colors and
  1px shadow, and inactive captions drop the shadow.
- Maximized windows push their 4px frame past the work area, like XP.
- The side edges are cut at extraction to the exact bitmap columns XP draws
  (four for windows, three for dialogs), so nothing is resampled. On
  high-density screens the frame, caption, and caption buttons scale by
  nearest neighbor, so each XP pixel stays a sharp block. Earlier, the 5px
  bitmaps were squeezed in the browser, which only matched at 1×.
- Menu bars are 19px with XP's 1px white bottom line, 6px item padding, and a
  flat blue highlight. Inactive windows draw their menu text in gray.
- Access-key underlines stay hidden until Alt, Tab, F10, or an arrow key is
  used, and hide again after mouse input.
- Scrollbars use the Luna arrows, shafts, thumbs, and grippers for each
  scheme, and Notepad shows the size grip in its scrollbar corner.
- Push buttons, check boxes, radio buttons, group boxes, tabs, tab pages,
  combo box buttons, and up-down controls use the Luna bitmaps with the
  theme's sizing margins. Selected tabs keep the orange highlight.
- Property sheets have the title bar ? button. It arms "What's This?" help:
  the next click shows the control's help, or XP's "No Help topic is
  associated with this item." Escape leaves help mode.
- A dialog behind another dialog draws inactive.
- Message boxes use user32's 32px icons, XP's spacing, and grow to fit their
  text. The Run error is titled with the command and uses XP's wording.
- The window menu shows Marlett-style glyphs, a bold Close with Alt+F4, and
  no separator after Size. A mouse-opened menu has no highlight.
- Open and Save As follow XP's layout: a Places bar with My Recent
  Documents, Desktop, My Documents, My Computer, and My Network, a Look
  in/Save in drop-down folder tree, Back, Up, Create New Folder, and a Views
  menu (Thumbnails, Tiles, Icons, List, Details), a file name combo box with
  recent names, the file type field, and a resize grip. My Pictures opens in
  Thumbnails view, which shows each picture scaled to fit its frame. Typing a
  folder's name and pressing Open or Save opens that folder.
- My Pictures has XP's Sample Pictures folder with Blue hills, Sunset, Water
  lilies, and Winter, extracted from the SP3 CD. Paint opens them, and the
  wallpaper Browse dialog sets them as the background.
- The wallpaper Browse dialog lists XP's Background Files types, BMP
  included.
- Properties and file dialogs show Explorer's icons instead of an emoji.

## Animations

- Minimizing, restoring and maximizing do not zoom the window. XP steps a
  caption from the window's rectangle, inset by its 4px frame, to the
  destination rectangle, then changes the window. The caption takes 16 steps
  at about 16 ms each, and its position and width follow the rectangle. The
  task button's rectangle is inset 4px at each side, and the last step drawn
  is the 15th, so the caption never lands on the destination.
- The caption is drawn the way DrawCaption draws it, not with the theme's
  caption art: Luna's 25px caption bar (Classic's 18px), with no caption
  buttons, frame or text shadow. The icon sits 5px in and 4px down (2px and
  1px in Classic), and the title starts 26px in (20px in Classic), 1px
  higher than on the window. The area behind the icon is the scheme's
  ActiveCaption color, and the gradient to GradientActiveCaption runs from
  the title to the end. The caption is drawn once, as wide as the wider
  rectangle, and each step shows its left part: a minimizing window's
  gradient is cut short, and a restoring one's runs past the task button.
- A window that isn't active steps an inactive caption. A restoring window
  steps an active one.
- Menus fade in over 200 ms, or unroll from the top when the scroll
  transition is chosen in Display Properties. With the transition effect
  off, menus appear at once. The Start menu's own flyouts appear at once.
- A reduced-motion browser preference stops the caption movement; the
  window changes at once.

Reference captures were recorded on the local XP VM with
`bun run xp:vm send --instance <name> record <directory> <ms> click <x> <y>`.

## Astro XP adaptations

- Windows Classic keeps its own 3D frames, controls, and scrollbars.
- My Recent Documents and My Network Places are empty folders.
- The wallpaper Browse dialog opens the browser's file picker on Open when the
  file name matches no picture in the current folder, so pictures on the
  computer can still be chosen. XP shows a "file not found" error.
- Sample Pictures is a system folder that cannot be deleted. In XP it is a
  link to the shared Sample Pictures folder. Its pictures can be deleted.
- Background Files leaves out web pages (.htm, .html), because Active
  Desktop is not part of Astro XP.

## Remaining differences

- The browser cannot tell when a scrollbar has nothing to scroll, so its
  arrows keep their normal look where XP grays them out.
- Text rasterization differs from XP, so text is about 1px off in places.
- Thumbnails view shows a folder's icon. XP draws a folder with previews of
  up to four pictures inside it.
- Picture files show the generic file icon in Explorer, the Start menu, and
  the file dialogs' other views. XP shows Paint's icon for BMP files and the
  Picture and Fax Viewer's icons for other pictures.
- The Date and Time clock, calendar border, and year spinner belong to the
  system utilities pass.
