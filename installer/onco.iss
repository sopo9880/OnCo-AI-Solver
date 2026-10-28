#define AppVersion "1.3.7"
#define ExtensionId "ljgoegcgbhhjhgpmdlnmnodadcdclgfm"
[Setup]
AppId={{6E2C201A-FF2F-45B3-898D-B6977CA8C167}
AppName=OnCo AI Solver
AppVersion={#AppVersion}
AppPublisher=OnCo AI Solver
AppPublisherURL=https://github.com/sopo9880/OnCo-AI-Solver
DefaultDirName={localappdata}\Programs\OnCo AI Solver
DefaultGroupName=OnCo AI Solver
UsePreviousAppDir=yes
PrivilegesRequired=lowest
Compression=lzma2
SolidCompression=yes
OutputDir=..\dist
OutputBaseFilename=OnCo_Setup_v{#AppVersion}
UninstallDisplayName=OnCo AI Solver
WizardStyle=modern
DisableProgramGroupPage=no
CloseApplications=yes

[Files]
Source: "..\dist\OnCoBridge.exe"; DestDir: "{app}\bridge"; Flags: ignoreversion
Source: "..\dist\bin\codex.exe"; DestDir: "{app}\bridge\bin"; Flags: ignoreversion
Source: "..\licenses\CODEX_APACHE_2.0.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "..\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "tutorial\*"; DestDir: "{app}\tutorial"; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\org.onco.ai_solver"; ValueType: string; ValueName: ""; ValueData: "{app}\bridge\host.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Naver\Naver Whale\NativeMessagingHosts\org.onco.ai_solver"; ValueType: string; ValueName: ""; ValueData: "{app}\bridge\host.json"; Flags: uninsdeletekey
; OnCo setup guide URI protocol. The bridge only opens allowlisted Chrome/Whale settings.
; Per-user registration needs no administrator elevation and is removed on uninstall.
Root: HKCU; Subkey: "Software\Classes\onco-ai-solver"; ValueType: string; ValueName: ""; ValueData: "URL:OnCo AI Solver Setup Guide"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\onco-ai-solver"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\onco-ai-solver\shell\open"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "OnCo AI Solver"
Root: HKCU; Subkey: "Software\Classes\onco-ai-solver\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\bridge\OnCoBridge.exe"" ""%1"""

[Icons]
Name: "{group}\OnCo 설치 및 확장 연결 안내"; Filename: "{app}\tutorial\index.html"
Name: "{group}\OnCo 확장 프로그램 폴더"; Filename: "{app}\extension"
Name: "{group}\OnCo AI Solver 제거"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\tutorial\index.html"; Description: "Chrome / Whale 확장 연결 튜토리얼 열기"; Flags: shellexec postinstall skipifsilent nowait

[Code]
function JsonQuotePath(Value: String): String;
begin
  StringChangeEx(Value, '\', '\\', True);
  StringChangeEx(Value, '"', '\"', True);
  Result := Value;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  HostJson: String;
  HostFile: String;
begin
  if CurStep = ssPostInstall then begin
    HostFile := ExpandConstant('{app}\bridge\host.json');
    HostJson := '{' + #13#10 +
      '  "name": "org.onco.ai_solver",' + #13#10 +
      '  "description": "OnCo Codex app-server native messaging bridge",' + #13#10 +
      '  "path": "' + JsonQuotePath(ExpandConstant('{app}\bridge\OnCoBridge.exe')) + '",' + #13#10 +
      '  "type": "stdio",' + #13#10 +
      '  "allowed_origins": ["chrome-extension://{#ExtensionId}/"]' + #13#10 +
      '}';
    if not SaveStringToFile(HostFile, HostJson, False) then
      MsgBox('인증 도우미 등록 파일을 만들지 못했습니다. 설치 폴더 권한을 확인하세요.', mbError, MB_OK);
  end;
end;
