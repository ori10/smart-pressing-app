package com.monpressing.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/** Ouvre la conversation WhatsApp (Business de préférence) d'un client, avec un texte ou une image. */
@CapacitorPlugin(name = "WaLauncher")
public class WaLauncherPlugin extends Plugin {

    @PluginMethod
    public void isInstalled(PluginCall call) {
        String pkg = call.getString("package", "");
        JSObject ret = new JSObject();
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            ret.put("installed", true);
        } catch (PackageManager.NameNotFoundException e) {
            ret.put("installed", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String phone = call.getString("phone", "");
        String text = call.getString("text", "");
        String pkg = call.getString("package", "");
        try {
            Intent i = new Intent(Intent.ACTION_VIEW,
                Uri.parse("https://api.whatsapp.com/send?phone=" + phone + "&text=" + Uri.encode(text)));
            if (!pkg.isEmpty()) i.setPackage(pkg);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("WhatsApp indisponible", e);
        }
    }

    @PluginMethod
    public void sendImage(PluginCall call) {
        String phone = call.getString("phone", "");
        String text = call.getString("text", "");
        String pkg = call.getString("package", "");
        String path = call.getString("path", "");
        try {
            File f = new File(Uri.parse(path).getPath());
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("image/png");
            i.putExtra(Intent.EXTRA_STREAM, uri);
            i.putExtra(Intent.EXTRA_TEXT, text);
            if (!phone.isEmpty()) i.putExtra("jid", phone + "@s.whatsapp.net");
            if (!pkg.isEmpty()) i.setPackage(pkg);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("WhatsApp indisponible", e);
        }
    }
}
