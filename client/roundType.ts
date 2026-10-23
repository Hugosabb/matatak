import * as cg from 'chessgroundx/types';

export interface MsgUserDisconnected {
    username: string;
}

export interface MsgUserPresent {
    username: string;
}

export interface MsgMoreTime {
    username: string;
}

export interface MsgDrawOffer {
    message: string;
    username: string;
}

export interface MsgDrawRejected {
    message: string;
}

export interface MsgRematchOffer {
    message: string;
    username: string;
}

export interface MsgRematchRejected {
    message: string;
}

export interface MsgCount {
    message: string;
}

export interface MsgSetup {
    fen: cg.FEN;
    color: cg.Color;
    phase: string;
}

export interface MsgGameStart {
    gameId: string;
    draft?: boolean; // Draft en cours : le son du début attend sa fin
}

export interface MsgViewRematch {
    gameId: string;
}

export interface MsgUpdateTV {
    gameId: string;
}

export interface MsgBerserk {
    color: cg.Color;
}
