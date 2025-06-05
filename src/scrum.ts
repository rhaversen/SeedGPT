import { ITheme, Theme } from './models/theme.schema.js'
import { IEpic, Epic } from './models/epic.schema.js'
import { IStory, Story } from './models/story.schema.js'
import { ITask, Task } from './models/task.schema.js'

// Theme
export async function addTheme(themeData: Partial<ITheme>): Promise<ITheme> {
  const theme = new Theme(themeData)
  return await theme.save()
}
export async function updateTheme(themeId: string, updates: Partial<ITheme>): Promise<ITheme | null> {
  return await Theme.findByIdAndUpdate(themeId, updates, { new: true })
}
export async function getActiveThemes(): Promise<ITheme[]> {
  return await Theme.find({ active: true })
}
export async function getAllThemes(): Promise<ITheme[]> {
  return await Theme.find()
}
export async function getTheme(themeId: string): Promise<ITheme | null> {
  return await Theme.findById(themeId)
}

// Epic
export async function addEpic(epicData: Partial<IEpic>): Promise<IEpic> {
  const epic = new Epic(epicData)
  return await epic.save()
}
export async function updateEpic(epicId: string, updates: Partial<IEpic>): Promise<IEpic | null> {
  return await Epic.findByIdAndUpdate(epicId, updates, { new: true })
}
export async function getAllEpics(): Promise<IEpic[]> {
  return await Epic.find()
}
export async function getEpic(epicId: string): Promise<IEpic | null> {
  return await Epic.findById(epicId)
}

// Story
export async function addStory(storyData: Partial<IStory>): Promise<IStory> {
  const story = new Story(storyData)
  return await story.save()
}
export async function updateStory(storyId: string, updates: Partial<IStory>): Promise<IStory | null> {
  return await Story.findByIdAndUpdate(storyId, updates, { new: true })
}
export async function getAllStories(): Promise<IStory[]> {
  return await Story.find()
}
export async function getStory(storyId: string): Promise<IStory | null> {
  return await Story.findById(storyId)
}

// Task
export async function addTask(taskData: Partial<ITask>): Promise<ITask> {
  const task = new Task(taskData)
  return await task.save()
}
export async function updateTask(taskId: string, updates: Partial<ITask>): Promise<ITask | null> {
  return await Task.findByIdAndUpdate(taskId, updates, { new: true })
}
export async function splitTask(taskId: string, newTasks: Partial<ITask>[]): Promise<ITask[]> {
  const originalTask = await Task.findById(taskId)
  if (!originalTask) {
    throw new Error('Task not found')
  }
  const createdTasks = newTasks.map(taskData => {
    const newTask = new Task({
      ...taskData
    })
    return newTask
  })
  await Task.deleteOne({ _id: taskId }) // Remove original task
  return await Task.insertMany(createdTasks) // Insert new tasks
}
export async function getEligibleTasks(): Promise<ITask[]> {
  return await Task.find({
    status: 'pending',
    $and: [
      { 'approvals': { $elemMatch: { department: 'evaluation', approved: true } } },
      { 'approvals': { $elemMatch: { department: 'code-quality', approved: true } } },
      { 'approvals': { $elemMatch: { department: 'safety', approved: true } } }
    ]
  })
}
export async function getAllTasks(): Promise<ITask[]> {
  return await Task.find()
}
export async function getTask(taskId: string): Promise<ITask | null> {
  return await Task.findById(taskId)
}
