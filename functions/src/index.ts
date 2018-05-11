import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as _ from 'lodash';
import * as qrcode from 'qrcode';
import { create } from 'domain';

admin.initializeApp();
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
    await admin
        .firestore()
        .collection('users')
        .doc(user.uid)
        .set({
            uid: user.uid,
            phoneNumber: user.phoneNumber,
            displayName: user.displayName,
            photoURL: user.photoURL
        });
    let stream = admin
        .storage()
        .bucket()
        .file(`user/${user.uid}/images/qrcode.png`)
        .createWriteStream();

    return await qrcode.toFileStream(stream, user.uid).then(d => console.log(d));
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
export const friendRequestAccepted = functions.database
    .ref(`user/{uid}/notification/{key}/accepted`)
    .onCreate(async (snapshot, context) => {
        let key = _.property('params.key')(context);
        let myUID: any = _.property('params.uid')(context);
        let dataSnapShot = await admin
            .database()
            .ref(`user/${myUID}/notification/${key}`)
            .once('value');
        let friendUID: any = _.property('from.uid')(dataSnapShot.val());
        let requestKey: any = _.property('key')(dataSnapShot.val());
        let requestRef = admin.database().ref(`user/${friendUID}/friend/requests/${requestKey}`);
        if (!snapshot.val()) {
            await requestRef.update({
                accepted: false
            });
            return -1;
        }

        await requestRef.update({
            accepted: true
        });

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
export const sendFCM = functions.database
    .ref(`history/{conversationId}/{messageId}`)
    .onCreate(async (snapshot, context) => {
        const conversationId = context.params.conversationId;
        const messageId = context.params.messageId;
        let { content, from } = snapshot.val();
        let { name, phoneNumber } = from;

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
                title: name || phoneNumber,
                body: content || 'GeChat'
            }
        };
        return sendMessage(tokens, payload);
    });
