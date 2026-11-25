!include "LogicLib.nsh"

!macro customInstall
  ; FIX_2026-11-24_VCPP_SKIP: run the VC++ installer only when VC++ 2015-2022 x64 is missing,
  ; so the Windows permission prompt appears once, on PCs that need it, not on every update.
  Push $R9
  ClearErrors
  SetRegView 64
  ReadRegDWORD $R9 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $R9 != 1
    ExecWait '"$INSTDIR\resources\app.asar.unpacked\resources\vc_redist.x64.exe" /install /quiet /norestart'
  ${EndIf}
  Pop $R9
!macroend
