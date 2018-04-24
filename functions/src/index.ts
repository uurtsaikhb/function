import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as _ from 'lodash';
admin.initializeApp();
export const inviteToConversation = functions.database
    .ref(`conversation/{key}/members/{index}`)
    .onCreate(async (snapshot, context) => {
        let { uid, phone } = snapshot.val();
        if (!uid) {
            uid = phone;
        }
        return admin
            .database()
            .ref(`user/${uid}/conversation/${context.params.key}`)
            .update({
                createdAt: admin.database.ServerValue.TIMESTAMP
            });
    });

export const signUp = functions.auth.user().onCreate(async (user, context) => {
    if (user.phoneNumber) {
        let record = await admin
            .database()
            .ref(`user/${user.phoneNumber}/conversation`)
            .once('value');
        let wall = await admin
            .database()
            .ref(`user/${user.uid}/conversation`)
            .update(record);
        let fire = admin.firestore().collection('');
    }
    return 0;
});
