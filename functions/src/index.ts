import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as _ from 'lodash';
import { create } from 'domain';

// admin.initializeApp();
var options = require('../options.json');
admin.initializeApp({
    credential: admin.credential.cert(options),
    databaseURL: 'https://ge-chat-fd58e.firebaseio.com'
});
// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });
export const inviteToConversation = functions.database
    .ref(`conversation/{key}/members/{index}`)
    .onCreate((snapshot, context) => {
        let { uid, phoneNumber } = snapshot.val();
        if (!uid) {
            uid = phoneNumber;
        }
        return admin
            .database()
            .ref(`user/${uid}/conversation/${context.params.key}`)
            .update({
                createdAt: admin.database.ServerValue.TIMESTAMP
            });
    });

export const signUp = functions.auth.user().onCreate(async (user, context) => {
    return await admin
        .firestore()
        .collection('users')
        .doc(user.uid)
        .set({
            uid: user.uid,
            phoneNumber: user.phoneNumber,
            displayName: user.displayName,
            photoURL: user.photoURL
        });
});
const normalizePhoneNumber = phoneNumber => {
    let fixed = (phoneNumber || '').replace(/[-\(\)\s]/g, '');
    if (fixed.indexOf('+') == 0) {
        return fixed;
    }
    if (fixed.length == 8) {
        return '+976' + fixed;
    }
    return '+1' + fixed;
};
export const friendRequest = functions.database
    .ref(`user/{uid}/friend/requests/{key}`)
    .onCreate(async (snapshot, context) => {
        let key = _.property('params.key')(context);
        let phoneNumber = snapshot.val().phoneNumber;
        let from = snapshot.val().from;
        let friends = await admin
            .firestore()
            .collection('users')
            .where('phoneNumber', '==', normalizePhoneNumber(phoneNumber))
            .get();

        console.log(snapshot.val(), normalizePhoneNumber(phoneNumber));
        return Promise.all(
            friends.docs.map(async friend => {
                return admin
                    .database()
                    .ref(`user/${friend.data().uid}/notification/`)
                    .push({
                        key,
                        type: 'friend-request',
                        from,
                        createdAt: admin.database.ServerValue.TIMESTAMP
                    });
            })
        );
    });
const findUserByUID = async uid => {
    let friends = await admin
        .firestore()
        .collection('users')
        .where('uid', '==', uid)
        .get();
    let found = friends.docs.shift();
    return found && found.data();
};
const createConversationBetweenFriends = async members => {
    let conversationKey = await admin
        .database()
        .ref('conversation')
        .push({
            createdAt: admin.database.ServerValue.TIMESTAMP,
            members
        }).key;
    await admin
        .database()
        .ref(`history/${conversationKey}`)
        .push({
            createdAt: admin.database.ServerValue.TIMESTAMP,
            content: 'Become friends',
            from: { uid: 'system' },
            type: 'text'
        });
    return conversationKey;
};

const registerFriends = async (myUID, friend, conversationKey) => {
    return await admin
        .database()
        .ref(`user/${myUID}/friend/list/${friend.uid}`)
        .set({
            ...friend,
            conversationKey,
            createdAt: admin.database.ServerValue.TIMESTAMP
        });
};
export const friendRequestAccepted = functions.database.ref(`user/{uid}/notification/{key}/accepted`).onCreate(async (snapshot, context) => {
    let key = _.property('params.key')(context);
    let myUID: any = _.property('params.uid')(context);
    let dataSnapShot = await admin
        .database()
        .ref(`user/${myUID}/notification/${key}`)
        .once('value');
    let friendUID: any = _.property('from.uid')(dataSnapShot.val());

        console.log(myUID, friendUID, `user/${myUID}/notification/${key}`);
        if (!friendUID) {
            return false;
        }
        let members = {};
        members[myUID] = await findUserByUID(myUID);
        members[friendUID] = await findUserByUID(friendUID);
        console.log(members);
        let conversationKey = await createConversationBetweenFriends(members);
        await registerFriends(myUID, members[friendUID], conversationKey);
        await registerFriends(friendUID, members[myUID], conversationKey);
        return true;
    });

const sendMessage = (tokens, payload) => {
    console.log(tokens, payload);
    return admin.messaging().sendToDevice(tokens, payload);
};
// TEST
// sendFCM('foo', {params: {conversationId: '-LBOF7ydAkKSI-BLGG6w'}})
export const sendFCM = functions.database.ref(`history/{conversationId}`).onCreate(async (snapshot, context) => {
    const conversationId = context.params.conversationId;
    const messageId = context.params.messageId;
    let { content, from } = snapshot.val();
    let { name } = from;

    // console.log('CONVERSATION ID', conversationId);

    // Get conversation member ids.
    let memberIds = await admin
        .database()
        .ref(`/conversation/${conversationId}/members`)
        .once('value');
    // console.log('MEMBERS', _.keys(memberIds.val()));

    //deviceInfo objects
    let infos = await Promise.all(
        _.chain(memberIds.val())
            .keys()
            .flatten()
            .map(async memberId => {
                let snapshot = await admin
                    .database()
                    .ref(`deviceInfo/${memberId}`)
                    .once('value');

                return snapshot.val();
            })
            .value()
    );

    //get all device tokens
    let tokens = infos
        .map(info => {
            return _.property('deviceId')(info);
        })
        .filter(info => info);

    const payload = {
        notification: {
            title: name,
            body: content
        }
    };
    return sendMessage(tokens, payload);
});
