export type DepartmentType = 'evaluation' | 'code-quality' | 'safety'
export type ModelType = 'low' | 'mid' | 'high'

export interface BaseTaskIdentifier {
  taskId: string
  department: DepartmentType
}

export interface WorkerPrompt extends BaseTaskIdentifier {
  workerIndex: number
  prompt: string
}

export interface HeadPrompt extends BaseTaskIdentifier {
  prompt: string
  workerResponses: WorkerResponse[]
}

export interface WorkerResponse extends BaseTaskIdentifier {
  workerIndex: number
  response: string
}

export interface HeadResponse extends BaseTaskIdentifier {
  approved: boolean
  feedback?: string
}

export interface BatchRequest<T extends WorkerPrompt | HeadPrompt> {
  prompts: T[]
  model: ModelType
}

export interface BatchResponse<T extends WorkerResponse | HeadResponse> {
  responses: T[]
}
