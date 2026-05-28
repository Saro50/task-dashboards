export interface CreateSessionBody {
  directory?: string;
  title?: string;
}

export interface SendMessageBody {
  text: string;
  agent?: string;
}
