import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  Dimensions,
} from 'react-native';
import InCallManager from 'react-native-incall-manager';
import messaging from '@react-native-firebase/messaging';
import {
  mediaDevices,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
} from 'react-native-webrtc';

type Stream = MediaStream | null;

const App = (): JSX.Element => {
  const [localStream, setLocalStream] = useState<Stream>(null);
  const [remoteStream, setRemoteStream] = useState<Stream>(null);
  const [type, setType] = useState<'JOIN' | 'INCOMING_CALL' | 'OUTGOING_CALL' | 'WEBRTC_ROOM'>('JOIN');
  const [callerInfo, setCallerInfo] = useState<{ callerName: string; handle: string; callId: string } | null>(null);
  const [fcmToken, setFcmToken] = useState<string | null>(null);

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const remoteRTCMessage = useRef<RTCSessionDescription | null>(null);
  const targetToken = useRef<string | null>(null); // FCM token of the other user

  useEffect(() => {
    const initializeFCM = async () => {
      try {
        // Request permission for FCM notifications
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (enabled) {
          // Get the FCM token
          const token = await messaging().getToken();
          setFcmToken(token);
          console.log('FCM Token:', token);
        }
      } catch (error) {
        console.error('Error initializing FCM:', error);
      }

      // Handle incoming FCM messages
      const unsubscribe = messaging().onMessage(async (remoteMessage) => {
        const data = remoteMessage.data;
        console.log('FCM Message Full Payload:', JSON.stringify(remoteMessage, null, 2));
        console.log('FCM Message Type:', remoteMessage.data?.type);
        console.log('FCM Message Data:', remoteMessage.data);

        if (remoteMessage.data?.type === 'voip') {
          const { caller_name, call_id, handle } = remoteMessage.data;
          
          // Store caller information
          setCallerInfo({
            callerName: caller_name,
            callId: call_id,
            handle: handle
          });
    
          // Set target token for response
          targetToken.current = remoteMessage.data.token;
    
          // Update UI to show incoming call
          setType('INCOMING_CALL');
    
          // Handle WebRTC setup
          if (remoteMessage.data?.rtcMessage) {
            const rtcMessage = typeof remoteMessage.data.rtcMessage === 'string' 
              ? JSON.parse(remoteMessage.data.rtcMessage)
              : remoteMessage.data.rtcMessage;
          
            
            if (rtcMessage.type === 'offer') {
              remoteRTCMessage.current = rtcMessage;
            } else if (rtcMessage.type === 'candidate') {
              const candidate = new RTCIceCandidate(rtcMessage);
              peerConnection.current?.addIceCandidate(candidate);
            }
          }
        }
      });

      return () => unsubscribe();
    };

    initializeFCM();
    
  }, []);

  useEffect(() => {
    const initializePeerConnection = async () => {
      try {
        const iceServers = [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ];
    
        const newPeerConnection = new RTCPeerConnection({ iceServers });
        peerConnection.current = newPeerConnection;
    
        const devices = await mediaDevices.enumerateDevices();
        const videoSourceId = devices.find(
          (device) => device.kind === 'videoinput' && device.facing === 'user'
        )?.deviceId;
    
        const stream = await mediaDevices.getUserMedia({
          audio: true,
          video: {
            mandatory: {
              minWidth: 500,
              minHeight: 300,
              minFrameRate: 30,
            },
            facingMode: 'user',
            optional: videoSourceId ? [{ sourceId: videoSourceId }] : [],
          },
        });
    
        setLocalStream(stream);
    
        // Use addTrack to add each track to the peer connection
        stream.getTracks().forEach((track) => {
          newPeerConnection.addTrack(track, stream);
        });
    
        newPeerConnection.ontrack = (event) => {
          const [remoteStream] = event.streams;
          setRemoteStream(remoteStream);
        };
    
        newPeerConnection.onicecandidate = (event) => {
          if (event.candidate && targetToken.current) {
            sendFCMMessage('icecandidate', JSON.stringify(event.candidate));
          }
        };
      } catch (error) {
        console.error('Error initializing peer connection:', error);
      }
    };

    initializePeerConnection();

    return () => {
      peerConnection.current?.close();
      peerConnection.current = null;
    };
  }, []);

  const sendFCMMessage = async (type: string, message: string) => {
    if (!targetToken.current) {
      console.error('Target token not set');
      return;
    }

    try {
      await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `key=YOUR_SERVER_KEY`, // Replace with your FCM server key
        },
        body: JSON.stringify({
          to: targetToken.current,
          data: { type, message },
        }),
      });
    } catch (error) {
      console.error('Error sending FCM message:', error);
    }
  };

  const processCall = async () => {
    const sessionDescription = await peerConnection.current?.createOffer();
    if (sessionDescription) {
      await peerConnection.current?.setLocalDescription(sessionDescription);
      sendFCMMessage('offer', JSON.stringify(sessionDescription));
    }
  };

  const processAccept = async () => {
    if (remoteRTCMessage.current) {
      peerConnection.current?.setRemoteDescription(
        new RTCSessionDescription(remoteRTCMessage.current)
      );
      const sessionDescription = await peerConnection.current?.createAnswer();
      if (sessionDescription) {
        await peerConnection.current?.setLocalDescription(sessionDescription);
        sendFCMMessage('answer', JSON.stringify(sessionDescription));
      }
    }
  };

  return (
    <View>
      <Text>WebRTC with FCM Signaling</Text>
      {/* UI Components */}
      {type === 'JOIN' && (
        <TouchableOpacity onPress={processCall}>
          <Text>Start Call</Text>
        </TouchableOpacity>
      )}
      {type === 'INCOMING_CALL' && (
        <TouchableOpacity onPress={processAccept}>
          <Text>Accept Call</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default App;
