package com.gathin.tvhome;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Offers res/raw/remote_keys.kcm to Android as a keyboard layout. Android only reads this receiver's manifest entry, it
 * never calls it. work/re/RemoteLayoutTool.java sets the layout on the remote; see VolumeSlider for why.
 */
public class RemoteLayout extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
    }
}
