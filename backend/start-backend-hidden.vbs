' DHOWN MES — backend auto-start launcher (runs node server.js with no window).
' Registered as a Windows logon task. Skips launch if the backend is already up.
Dim shell, wmi, procs, p, running
Set shell = CreateObject("WScript.Shell")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='node.exe'")
running = False
For Each p In procs
  If Not IsNull(p.CommandLine) Then
    If InStr(p.CommandLine, "server.js") > 0 Then running = True
  End If
Next
If Not running Then
  shell.CurrentDirectory = "D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backend"
  ' window style 0 = hidden; False = don't wait
  shell.Run """C:\Program Files\nodejs\node.exe"" server.js", 0, False
End If
