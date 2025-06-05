export interface DepartmentPrompt {
  department: string
  taskId: string
  prompt: string
}

export interface WorkerPrompt extends DepartmentPrompt {
  workerId: string
}

export interface HeadPrompt extends DepartmentPrompt {
  headId: string
}

export interface WorkerResponse {
  workerId: string
  taskId: string
  department: string
  response: string
}

export interface HeadResponse {
  taskId: string
  approved: boolean
  department: string
  report?: string
}

export interface BatchPromptRequest {
  prompts: WorkerPrompt[] | HeadPrompt[]
  model: 'low' | 'mid' | 'high'
}

export interface BatchPromptResponse {
  responses: WorkerResponse[] | HeadResponse[]
}
