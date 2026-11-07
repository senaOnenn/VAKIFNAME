package com.tikirsoft.vakifname;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Bundle;

/**
 * Açılış: ilk açılışta konum iznini uygulama ön plandayken bir kez sorar, sonra siteyi açar.
 *
 * Neden: Android 14+ (cihazda Android 16 ile görüldü, 7 Kasım) arka plandaki uygulamanın pencere açmasını engeller
 * (BAL_BLOCK). Chrome konum iznini site açıkken sorduğunda izin penceresi uygulamanın arka plan servisinden açılmaya
 * çalışır ve engellenir; site "konum alınamadı" der. İzin önceden verilmişse pencere gerekmez. Reddedilirse bir daha
 * açılışta sorulmaz; ziyaret ve rota konumsuz (şehir merkezinden) çalışmaya devam eder, izin Ayarlar'dan verilebilir.
 */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    private static final String PREFS = "vakifname";
    private static final String ASKED = "location_asked";
    private static final int REQUEST_LOCATION = 1;
    private boolean asking;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        asking = savedInstanceState == null && shouldAskLocation();
        super.onCreate(savedInstanceState);
        if (asking) {
            prefs().edit().putBoolean(ASKED, true).apply();
            requestPermissions(new String[] {
                    Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION
            }, REQUEST_LOCATION);
        }
    }

    @Override
    protected boolean shouldLaunchImmediately() {
        return !asking;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_LOCATION && asking) {
            asking = false;
            launchTwa();
        }
    }

    private boolean shouldAskLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return !prefs().getBoolean(ASKED, false);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }
}
