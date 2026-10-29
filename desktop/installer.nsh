; Installer page with the lyrics-sync checkbox. The choice is written to resources\sync-lyrics.txt
; and becomes the app's setting on first launch (it can be changed later in the app's settings).
; Saved as UTF-8 with BOM: without it NSIS reads the Cyrillic text in the ANSI code page.
!ifndef BUILD_UNINSTALLER
!include nsDialogs.nsh
!include LogicLib.nsh

Var SyncCheckbox
Var SyncLyrics

!macro customInit
  ; Silent installs and updates don't show the page: keep syncing on.
  StrCpy $SyncLyrics ${BST_CHECKED}
!macroend

; Inserted among the pages, after MUI is set up, so the page functions live here too.
!macro customPageAfterChangeDir
  Page custom SyncPageCreate SyncPageLeave

  Function SyncPageCreate
    !insertmacro MUI_HEADER_TEXT "Тексты песен" "Автоматическая синхронизация текстов"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 24u "Если у песни есть только текст без тайминга, плеер может сам расставить строки по времени, чтобы они подсвечивались вместе с музыкой."
    Pop $0
    ${NSD_CreateLabel} 0 28u 100% 24u "Для этого при первом запуске скачается модель (364 МБ). Включить или удалить её можно в любой момент в настройках."
    Pop $0
    ${NSD_CreateCheckbox} 0 56u 100% 12u "Синхронизировать тексты (скачать модель, 364 МБ)"
    Pop $SyncCheckbox
    ${NSD_SetState} $SyncCheckbox $SyncLyrics
    nsDialogs::Show
  FunctionEnd

  Function SyncPageLeave
    ${NSD_GetState} $SyncCheckbox $SyncLyrics
  FunctionEnd
!macroend

!macro customInstall
  FileOpen $0 "$INSTDIR\resources\sync-lyrics.txt" w
  ${If} $SyncLyrics == ${BST_CHECKED}
    FileWrite $0 "1"
  ${Else}
    FileWrite $0 "0"
  ${EndIf}
  FileClose $0
!macroend
!endif
