package com.gathin.tvhome;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.IOException;
import org.junit.Test;

/** The link token the phone writes, as the signInWithIdp postBody the TV sends (phone/SPEC.md, "Sign in with Apple"). */
public class OrbitCloudLinkTokenTest {

    @Test
    public void aGoogleIdTokenGoesAsItIs() throws IOException {
        assertEquals("id_token=aaa.bbb.ccc&providerId=google.com", OrbitCloud.idpPostBody("aaa.bbb.ccc"));
    }

    @Test
    public void anAppleTokenCarriesItsNonce() throws IOException {
        assertEquals(
                "id_token=aaa.bbb.ccc&providerId=apple.com&nonce=Xy_9-AbC",
                OrbitCloud.idpPostBody("apple.com|Xy_9-AbC|aaa.bbb.ccc"));
    }

    @Test
    public void aBrokenAppleTokenIsRefused() {
        assertThrows(IOException.class, () -> OrbitCloud.idpPostBody("apple.com|aaa.bbb.ccc"));
        assertThrows(IOException.class, () -> OrbitCloud.idpPostBody("apple.com||aaa.bbb.ccc"));
        assertThrows(IOException.class, () -> OrbitCloud.idpPostBody("apple.com|nonce|"));
        assertThrows(IOException.class, () -> OrbitCloud.idpPostBody("apple.com|a|b|c"));
    }
}
